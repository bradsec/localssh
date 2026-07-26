// The one persisted artefact of the address book: a sealed envelope under a
// single localStorage key. Nothing here can read the vault; the shape check
// exists only so that junk never reaches the engine.

export const VAULT_STORAGE_KEY = "vault";

/** The envelope version this build understands. Mirrors envelopeVersion in Go. */
const SUPPORTED_VERSION = 1;

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

export function saveVaultBlob(blob: string): void {
  try {
    localStorage.setItem(VAULT_STORAGE_KEY, blob);
  } catch (error) {
    if (isQuotaError(error)) throw new StorageFullError();
    throw new StorageUnavailableError();
  }
}

export function clearVaultBlob(): void {
  try {
    localStorage.removeItem(VAULT_STORAGE_KEY);
  } catch {
    // Storage is unavailable; there was nothing stored to remove.
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
