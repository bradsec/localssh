import { useCallback, useState } from "react";
import {
  changeMasterPassword,
  createVault,
  deleteEntry,
  lockVault,
  unlockVault,
  upsertEntry,
  type EntryInput,
  type SavedEntry,
} from "./vaultEngine.js";
import {
  clearVaultBlob,
  hasVaultBlob,
  isStorageAvailable,
  loadVaultBlob,
  saveVaultBlob,
} from "./vaultStore.js";

export type VaultStatus = "unavailable" | "absent" | "locked" | "unlocked";

export interface VaultApi {
  status: VaultStatus;
  entries: SavedEntry[];
  busy: boolean;
  error: string | null;
  create(masterPassword: string): Promise<boolean>;
  unlock(masterPassword: string): Promise<boolean>;
  save(input: EntryInput): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  changePassword(current: string, next: string): Promise<boolean>;
  lock(): Promise<boolean>;
  reset(): Promise<boolean>;
  clearError(): void;
}

function initialStatus(): VaultStatus {
  if (!isStorageAvailable()) return "unavailable";
  return hasVaultBlob() ? "locked" : "absent";
}

/**
 * Owns the vault's lifecycle for one page load. An unlock lasts until the page
 * goes away: there is no timer and no persisted key, so a reload always asks
 * for the master password again.
 */
export function useVault(): VaultApi {
  const [status, setStatus] = useState<VaultStatus>(initialStatus);
  const [entries, setEntries] = useState<SavedEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every action funnels through here so that no rejection reaches a component
  // and the busy flag can never be left stuck on.
  const run = useCallback(async (action: () => Promise<void>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      // Go/wasm shares the page thread. Let React paint the pending state
      // before an Argon2id call blocks rendering.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await action();
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const persist = useCallback(async (blob: string): Promise<void> => {
    try {
      saveVaultBlob(blob);
    } catch (failure) {
      // The engine mutation has happened but storage has not. Fail closed so
      // no later action can build on state that a reload would lose.
      await lockVault();
      setEntries([]);
      setStatus(hasVaultBlob() ? "locked" : "absent");
      throw failure;
    }
  }, []);

  const create = useCallback(
    (masterPassword: string) =>
      run(async () => {
        const blob = await createVault(masterPassword);
        await persist(blob);
        setEntries([]);
        setStatus("unlocked");
      }),
    [persist, run],
  );

  const unlock = useCallback(
    (masterPassword: string) =>
      run(async () => {
        const blob = loadVaultBlob();
        if (blob === null) {
          setStatus("absent");
          throw new Error("There is no saved vault in this browser.");
        }
        const opened = await unlockVault(blob, masterPassword);
        setEntries(opened.entries);
        setStatus("unlocked");
      }),
    [run],
  );

  const save = useCallback(
    (input: EntryInput) =>
      run(async () => {
        const result = await upsertEntry(input);
        await persist(result.blob);
        setEntries(result.entries);
      }),
    [persist, run],
  );

  const remove = useCallback(
    (id: string) =>
      run(async () => {
        const result = await deleteEntry(id);
        await persist(result.blob);
        setEntries(result.entries);
      }),
    [persist, run],
  );

  const changePassword = useCallback(
    (current: string, next: string) =>
      run(async () => {
        await persist(await changeMasterPassword(current, next));
      }),
    [persist, run],
  );

  const lock = useCallback(
    () =>
      run(async () => {
        await lockVault();
        setEntries([]);
        setStatus("locked");
      }),
    [run],
  );

  // There is no recovery by design, so this is the only door out of a
  // forgotten master password, and it destroys the vault.
  const reset = useCallback(
    () =>
      run(async () => {
        await lockVault();
        clearVaultBlob();
        setEntries([]);
        setStatus("absent");
      }),
    [run],
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    status,
    entries,
    busy,
    error,
    create,
    unlock,
    save,
    remove,
    changePassword,
    lock,
    reset,
    clearError,
  };
}
