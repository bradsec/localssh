import { openDB } from "idb";
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

  it("saves while an older tab holds the known-host database open", async () => {
    const legacy = await openDB("localssh", 2, {
      upgrade(db) {
        db.createObjectStore("knownHosts", { keyPath: "hostPort" });
      },
    });
    const blocked = new Promise((resolve) => {
      legacy.addEventListener("versionchange", () => resolve("blocked"), { once: true });
    });
    const save = saveVaultBlob(validBlob, null);
    try {
      const outcome = await Promise.race([save.then(() => "saved"), blocked]);
      expect(outcome).toBe("saved");
    } finally {
      legacy.close();
      await save;
    }
  });

  it("reports no vault when nothing is stored", () => {
    expect(loadVaultBlob()).toBeNull();
    expect(hasVaultBlob()).toBe(false);
  });

  it("round-trips a well-formed envelope", async () => {
    await saveVaultBlob(validBlob, null);
    expect(loadVaultBlob()).toBe(validBlob);
  });

  it("uses exactly one storage key", async () => {
    await saveVaultBlob(validBlob, null);
    expect(Object.keys(localStorage)).toEqual([VAULT_STORAGE_KEY]);
  });

  it("rejects a stale save after another tab changes the password", async () => {
    localStorage.setItem(VAULT_STORAGE_KEY, validBlob);
    const rekeyed = JSON.stringify({ ...JSON.parse(validBlob), ct: "new-password" });
    await saveVaultBlob(rekeyed, validBlob);
    await expect(saveVaultBlob(validBlob, validBlob)).rejects.toThrow(/changed.*unlock again/i);
    expect(loadVaultBlob()).toBe(rekeyed);
  });

  it("allows only one simultaneous writer for the same loaded blob", async () => {
    localStorage.setItem(VAULT_STORAGE_KEY, validBlob);
    const first = JSON.stringify({ ...JSON.parse(validBlob), ct: "first" });
    const second = JSON.stringify({ ...JSON.parse(validBlob), ct: "second" });
    const results = await Promise.allSettled([
      saveVaultBlob(first, validBlob),
      saveVaultBlob(second, validBlob),
    ]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(loadVaultBlob()).toBe(first);
  });

  it("refuses creation over an existing vault", async () => {
    localStorage.setItem(VAULT_STORAGE_KEY, validBlob);
    await expect(saveVaultBlob("replacement", null)).rejects.toThrow(/changed/i);
    expect(loadVaultBlob()).toBe(validBlob);
  });

  it("does not recreate a vault another tab deleted", async () => {
    await expect(saveVaultBlob(validBlob, validBlob)).rejects.toThrow(/changed/i);
    expect(hasVaultBlob()).toBe(false);
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

  it("clears the stored vault", async () => {
    await saveVaultBlob(validBlob, null);
    await clearVaultBlob();
    expect(localStorage.getItem(VAULT_STORAGE_KEY)).toBeNull();
  });

  it("reports storage as unavailable when it throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(isStorageAvailable()).toBe(false);
  });

  // Reads degrade safely. Failed writes and deletion must be reported because
  // pretending either succeeded would put UI state ahead of storage.
  it("survives a throwing localStorage", async () => {
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
    await expect(saveVaultBlob(validBlob, null)).rejects.toThrowError(/storage is unavailable/i);
    await expect(clearVaultBlob()).rejects.toThrowError(/storage is unavailable/i);
  });

  it("throws a typed error when the quota is exceeded", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    await expect(saveVaultBlob(validBlob, null)).rejects.toThrowError(/storage is full/i);
  });
});
