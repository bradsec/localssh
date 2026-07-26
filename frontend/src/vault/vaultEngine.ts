import { loadEngine } from "../ssh/engine.js";

/**
 * An entry as the page sees it. There is deliberately no password field: the
 * engine reports only whether one is saved, and resolves the value itself when
 * a connection references the entry.
 */
export interface SavedEntry {
  id: string;
  nickname: string;
  host: string;
  port: number;
  username?: string;
  hasPassword: boolean;
}

/**
 * An entry as the editor submits it. An absent `password` keeps whatever is
 * saved, because the editor cannot display a password it never receives. An
 * empty string clears it.
 */
export interface EntryInput {
  id: string;
  nickname: string;
  host: string;
  port: number;
  username: string;
  password?: string;
}

export class WrongPasswordError extends Error {
  constructor() {
    super("That master password is not correct.");
    this.name = "WrongPasswordError";
  }
}

export class VaultLockedError extends Error {
  constructor() {
    super("The vault is locked.");
    this.name = "VaultLockedError";
  }
}

declare global {
  interface Window {
    vaultCreate: (masterPassword: string) => Promise<string>;
    vaultUnlock: (blob: string, masterPassword: string) => Promise<string>;
    vaultList: () => Promise<string>;
    vaultUpsert: (entryJson: string) => Promise<string>;
    vaultDelete: (id: string) => Promise<string>;
    vaultChangePassword: (current: string, next: string) => Promise<string>;
    vaultLock: () => Promise<null>;
  }
}

export async function createVault(masterPassword: string): Promise<string> {
  await loadEngine();
  return call(() => window.vaultCreate(masterPassword));
}

export async function unlockVault(
  blob: string,
  masterPassword: string,
): Promise<{ blob: string; entries: SavedEntry[] }> {
  await loadEngine();
  const listed = await call(() => window.vaultUnlock(blob, masterPassword));
  return { blob, entries: parseEntries(listed) };
}

export async function upsertEntry(
  input: EntryInput,
): Promise<{ blob: string; entries: SavedEntry[] }> {
  await loadEngine();
  const blob = await call(() => window.vaultUpsert(encodeInput(input)));
  return { blob, entries: parseEntries(await call(() => window.vaultList())) };
}

export async function deleteEntry(id: string): Promise<{ blob: string; entries: SavedEntry[] }> {
  await loadEngine();
  const blob = await call(() => window.vaultDelete(id));
  return { blob, entries: parseEntries(await call(() => window.vaultList())) };
}

export async function changeMasterPassword(current: string, next: string): Promise<string> {
  await loadEngine();
  return call(() => window.vaultChangePassword(current, next));
}

export async function lockVault(): Promise<void> {
  await loadEngine();
  await call(() => window.vaultLock());
}

// JSON.stringify drops an undefined value, but only for a key that is present
// with that value. Building the object explicitly keeps "absent" and "empty"
// distinguishable, which is the whole keep-or-clear contract.
function encodeInput(input: EntryInput): string {
  const wire: Record<string, unknown> = {
    id: input.id,
    nickname: input.nickname,
    host: input.host,
    port: input.port,
    username: input.username,
  };
  if (input.password !== undefined) wire.password = input.password;
  return JSON.stringify(wire);
}

function parseEntries(json: string): SavedEntry[] {
  const parsed: unknown = JSON.parse(json);
  return Array.isArray(parsed) ? (parsed as SavedEntry[]) : [];
}

// The Go bridge rejects with a plain string, so failures arrive untyped.
async function call<T>(invoke: () => Promise<T>): Promise<T> {
  try {
    return await invoke();
  } catch (error) {
    const message = typeof error === "string" ? error : String(error);
    if (message.includes("wrong master password")) throw new WrongPasswordError();
    if (message.includes("vault: locked")) throw new VaultLockedError();
    throw error instanceof Error ? error : new Error(message);
  }
}
