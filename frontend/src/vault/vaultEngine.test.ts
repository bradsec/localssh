import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  VaultLockedError,
  WrongPasswordError,
  changeMasterPassword,
  createVault,
  deleteEntry,
  lockVault,
  unlockVault,
  upsertEntry,
} from "./vaultEngine.js";

vi.mock("../ssh/engine.js", () => ({ loadEngine: vi.fn().mockResolvedValue(undefined) }));

const entries = [
  { id: "a", nickname: "web", host: "10.0.0.4", port: 22, username: "deploy", hasPassword: true },
];

const globals = {
  vaultCreate: vi.fn(),
  vaultUnlock: vi.fn(),
  vaultList: vi.fn(),
  vaultUpsert: vi.fn(),
  vaultDelete: vi.fn(),
  vaultChangePassword: vi.fn(),
  vaultLock: vi.fn(),
};

beforeEach(() => {
  for (const [name, fn] of Object.entries(globals)) {
    fn.mockReset();
    Object.defineProperty(window, name, { value: fn, configurable: true });
  }
  globals.vaultCreate.mockResolvedValue("blob-1");
  globals.vaultUnlock.mockResolvedValue(JSON.stringify(entries));
  globals.vaultList.mockResolvedValue(JSON.stringify(entries));
  globals.vaultUpsert.mockResolvedValue("blob-2");
  globals.vaultDelete.mockResolvedValue("blob-3");
  globals.vaultChangePassword.mockResolvedValue("blob-4");
  globals.vaultLock.mockResolvedValue(null);
});

describe("vaultEngine", () => {
  it("creates a vault and returns the sealed blob", async () => {
    await expect(createVault("master")).resolves.toBe("blob-1");
    expect(globals.vaultCreate).toHaveBeenCalledWith("master");
  });

  it("unlocks and parses the redacted entries", async () => {
    const result = await unlockVault("blob-1", "master");

    expect(globals.vaultUnlock).toHaveBeenCalledWith("blob-1", "master");
    expect(result.blob).toBe("blob-1");
    expect(result.entries).toEqual(entries);
  });

  it("maps a wrong password to a typed error", async () => {
    globals.vaultUnlock.mockRejectedValue("vault: wrong master password");
    await expect(unlockVault("blob-1", "nope")).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it("maps a locked vault to a typed error", async () => {
    globals.vaultList.mockRejectedValue("vault: locked");
    globals.vaultUpsert.mockRejectedValue("vault: locked");
    await expect(
      upsertEntry({ id: "a", nickname: "web", host: "h", port: 22, username: "u" }),
    ).rejects.toBeInstanceOf(VaultLockedError);
  });

  // An absent password means "keep the saved one", so the key must not appear.
  it("omits the password key when the field is absent", async () => {
    await upsertEntry({ id: "a", nickname: "web", host: "h", port: 22, username: "u" });

    const sent = JSON.parse(globals.vaultUpsert.mock.calls[0]![0] as string) as Record<
      string,
      unknown
    >;
    expect("password" in sent).toBe(false);
  });

  it("sends an empty password when the field is an empty string", async () => {
    await upsertEntry({
      id: "a",
      nickname: "web",
      host: "h",
      port: 22,
      username: "u",
      password: "",
    });

    const sent = JSON.parse(globals.vaultUpsert.mock.calls[0]![0] as string) as Record<
      string,
      unknown
    >;
    expect(sent.password).toBe("");
  });

  it("re-lists entries after an upsert", async () => {
    const result = await upsertEntry({
      id: "a",
      nickname: "web",
      host: "h",
      port: 22,
      username: "u",
      password: "hunter2",
    });

    expect(result.blob).toBe("blob-2");
    expect(result.entries).toEqual(entries);
  });

  it("re-lists entries after a delete", async () => {
    const result = await deleteEntry("a");

    expect(globals.vaultDelete).toHaveBeenCalledWith("a");
    expect(result.blob).toBe("blob-3");
  });

  it("changes the master password", async () => {
    await expect(changeMasterPassword("old", "new")).resolves.toBe("blob-4");
    expect(globals.vaultChangePassword).toHaveBeenCalledWith("old", "new");
  });

  it("locks the vault", async () => {
    await lockVault();
    expect(globals.vaultLock).toHaveBeenCalled();
  });

  // The engine rejects with a plain string, not an Error.
  it("wraps an unrecognised rejection in an Error", async () => {
    globals.vaultCreate.mockRejectedValue("vault: something else");
    await expect(createVault("master")).rejects.toThrowError(/something else/);
  });
});
