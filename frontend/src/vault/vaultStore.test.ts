import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  VAULT_STORAGE_KEY,
  clearVaultBlob,
  hasVaultBlob,
  isStorageAvailable,
  loadVaultBlob,
  saveVaultBlob,
} from "./vaultStore.js";

const validBlob = JSON.stringify({
  v: 1,
  kdf: "argon2id",
  t: 3,
  m: 65536,
  p: 1,
  salt: "c2FsdHNhbHRzYWx0c2E=",
  nonce: "bm9uY2Vub25jZW5vbmNlbm9uY2Vubw==",
  ct: "Y2lwaGVy",
});

describe("vaultStore", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("reports no vault when nothing is stored", () => {
    expect(loadVaultBlob()).toBeNull();
    expect(hasVaultBlob()).toBe(false);
  });

  it("round-trips a well-formed envelope", () => {
    saveVaultBlob(validBlob);
    expect(loadVaultBlob()).toBe(validBlob);
  });

  it("uses exactly one storage key", () => {
    saveVaultBlob(validBlob);
    expect(Object.keys(localStorage)).toEqual([VAULT_STORAGE_KEY]);
  });

  // A corrupt value must not be handed to the engine, and must not be silently
  // deleted either: deleting it would destroy a vault that a later build might
  // still be able to read.
  it("rejects a malformed envelope without deleting it", () => {
    localStorage.setItem(VAULT_STORAGE_KEY, "not json");
    expect(() => loadVaultBlob()).toThrowError(/corrupt or.*unsupported/i);
    expect(hasVaultBlob()).toBe(true);
    expect(localStorage.getItem(VAULT_STORAGE_KEY)).toBe("not json");
  });

  it("rejects an envelope missing required fields", () => {
    localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify({ v: 1, ct: "Y2lwaGVy" }));
    expect(() => loadVaultBlob()).toThrowError(/corrupt or.*unsupported/i);
  });

  it("rejects an envelope from a future version", () => {
    localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify({ ...JSON.parse(validBlob), v: 2 }));
    expect(() => loadVaultBlob()).toThrowError(/corrupt or.*unsupported/i);
  });

  it("clears the stored vault", () => {
    saveVaultBlob(validBlob);
    clearVaultBlob();
    expect(localStorage.getItem(VAULT_STORAGE_KEY)).toBeNull();
  });

  it("reports storage as unavailable when it throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(isStorageAvailable()).toBe(false);
  });

  // Reads and cleanup degrade safely. A failed write must be reported because
  // pretending it persisted would put WASM state ahead of storage.
  it("survives a throwing localStorage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(() => loadVaultBlob()).not.toThrow();
    expect(loadVaultBlob()).toBeNull();
    expect(hasVaultBlob()).toBe(false);
    expect(() => saveVaultBlob(validBlob)).toThrowError(/storage is unavailable/i);
    expect(() => clearVaultBlob()).not.toThrow();
  });

  it("throws a typed error when the quota is exceeded", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(() => saveVaultBlob(validBlob)).toThrowError(/storage is full/i);
  });
});
