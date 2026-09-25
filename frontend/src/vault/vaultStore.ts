import { openDB, type IDBPDatabase } from "idb";

// The one persisted artefact of the address book: a sealed envelope under a
// single localStorage key. Nothing here can read the vault; the shape check
// exists only so that junk never reaches the engine.

export const VAULT_STORAGE_KEY = "vault";

/** The envelope version this build understands. Mirrors envelopeVersion in Go. */
const SUPPORTED_VERSION = 1;

let writeDB: Promise<IDBPDatabase> | null = null;

export class StorageFullError extends Error {
  constructor() {
    super("Browser storage is full, so the vault could not be saved.");
    this.name = "StorageFullError";
  }
}

export class StorageUnavailableError extends Error {
  constructor() {
    super("Browser storage is unavailable, so the vault could not be saved.");
    this.name = "StorageUnavailableError";
  }
}

export class InvalidVaultBlobError extends Error {
  constructor() {
    super("The saved vault is corrupt or was created by an unsupported version.");
    this.name = "InvalidVaultBlobError";
  }
}

export function isStorageAvailable(): boolean {
  try {
    const probe = "__vault_probe__";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export function loadVaultBlob(): string | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(VAULT_STORAGE_KEY);
  } catch {
    return null; // storage blocked, e.g. Safari private browsing
  }
  if (!raw) return null;
  if (!isEnvelope(raw)) throw new InvalidVaultBlobError();
  return raw;
}

export function hasVaultBlob(): boolean {
  try {
    return localStorage.getItem(VAULT_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export class StaleVaultError extends Error {
  constructor() {
    super("The vault changed in another tab. Reload this page and unlock again before saving.");
    this.name = "StaleVaultError";
  }
}

export async function saveVaultBlob(blob: string, expected: string | null): Promise<void> {
  await withVaultLock(() => {
    if (localStorage.getItem(VAULT_STORAGE_KEY) !== expected) throw new StaleVaultError();
    localStorage.setItem(VAULT_STORAGE_KEY, blob);
  });
}

export async function clearVaultBlob(): Promise<void> {
  await withVaultLock(() => localStorage.removeItem(VAULT_STORAGE_KEY));
}

async function withVaultLock(action: () => void): Promise<void> {
  try {
    // Keep this separate so an older tab's known-host connection cannot
    // block vault writes by holding an earlier database schema open.
    writeDB ??= openDB("localssh-vault-writes", 1, {
      upgrade(db) {
        db.createObjectStore("vaultWrites");
      },
    });
    const db = await writeDB;
    const transaction = db.transaction("vaultWrites", "readwrite");
    // A request runs only once this transaction owns the store. Keep the
    // localStorage comparison and mutation synchronous while it holds the lock.
    await Promise.all([transaction.store.get("lock").then(action), transaction.done]);
  } catch (error) {
    if (error instanceof StaleVaultError) throw error;
    if (isQuotaError(error)) throw new StorageFullError();
    throw new StorageUnavailableError();
  }
}

function isEnvelope(raw: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null) return false;

  const { v, kdf, t, m, p, salt, nonce, ct } = parsed as Record<string, unknown>;
  return (
    v === SUPPORTED_VERSION &&
    kdf === "argon2id" &&
    typeof t === "number" &&
    typeof m === "number" &&
    typeof p === "number" &&
    typeof salt === "string" &&
    salt !== "" &&
    typeof nonce === "string" &&
    nonce !== "" &&
    typeof ct === "string" &&
    ct !== ""
  );
}

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")
  );
}
