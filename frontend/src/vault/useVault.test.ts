import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useVault } from "./useVault.js";
import * as engine from "./vaultEngine.js";
import * as store from "./vaultStore.js";

vi.mock("./vaultEngine.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./vaultEngine.js")>();
  return {
    ...actual,
    changeMasterPassword: vi.fn(),
    createVault: vi.fn(),
    deleteEntry: vi.fn(),
    lockVault: vi.fn(),
    unlockVault: vi.fn(),
    upsertEntry: vi.fn(),
  };
});
vi.mock("./vaultStore.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./vaultStore.js")>();
  return {
    ...actual,
    clearVaultBlob: vi.fn(),
    hasVaultBlob: vi.fn(),
    isStorageAvailable: vi.fn(),
    loadVaultBlob: vi.fn(),
    saveVaultBlob: vi.fn(),
  };
});

const entries = [
  { id: "a", nickname: "web", host: "10.0.0.4", port: 22, username: "deploy", hasPassword: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.mocked(store.isStorageAvailable).mockReturnValue(true);
  vi.mocked(store.hasVaultBlob).mockReturnValue(false);
  vi.mocked(store.loadVaultBlob).mockReturnValue(null);
  vi.mocked(store.saveVaultBlob).mockImplementation(() => {});
  vi.mocked(store.clearVaultBlob).mockImplementation(() => {});
  vi.mocked(engine.createVault).mockResolvedValue("blob-1");
  vi.mocked(engine.unlockVault).mockResolvedValue({ blob: "blob-1", entries });
  vi.mocked(engine.upsertEntry).mockResolvedValue({ blob: "blob-2", entries });
  vi.mocked(engine.deleteEntry).mockResolvedValue({ blob: "blob-3", entries: [] });
  vi.mocked(engine.changeMasterPassword).mockResolvedValue("blob-4");
});

describe("useVault", () => {
  it("starts absent when nothing is stored", () => {
    const { result } = renderHook(() => useVault());
    expect(result.current.status).toBe("absent");
  });

  it("starts locked when a vault is stored", () => {
    vi.mocked(store.hasVaultBlob).mockReturnValue(true);
    vi.mocked(store.loadVaultBlob).mockReturnValue("blob-1");
    const { result } = renderHook(() => useVault());
    expect(result.current.status).toBe("locked");
  });

  it("reports unavailable when storage is blocked", () => {
    vi.mocked(store.isStorageAvailable).mockReturnValue(false);
    const { result } = renderHook(() => useVault());
    expect(result.current.status).toBe("unavailable");
  });

  it("keeps a corrupt stored vault locked and blocks replacement", async () => {
    vi.mocked(store.hasVaultBlob).mockReturnValue(true);
    vi.mocked(store.loadVaultBlob).mockImplementation(() => {
      throw new store.InvalidVaultBlobError();
    });
    const { result } = renderHook(() => useVault());

    let outcome = true;
    await act(async () => {
      outcome = await result.current.unlock("master password");
    });

    expect(outcome).toBe(false);
    expect(result.current.status).toBe("locked");
    expect(result.current.error).toMatch(/corrupt or.*unsupported/i);
    expect(engine.createVault).not.toHaveBeenCalled();
  });

  it("creates a vault, persists the blob, and unlocks", async () => {
    const { result } = renderHook(() => useVault());

    await act(async () => {
      await result.current.create("master password");
    });

    expect(store.saveVaultBlob).toHaveBeenCalledWith("blob-1");
    expect(result.current.status).toBe("unlocked");
    expect(result.current.entries).toEqual([]);
  });

  it("unlocks a stored vault and lists its entries", async () => {
    vi.mocked(store.hasVaultBlob).mockReturnValue(true);
    vi.mocked(store.loadVaultBlob).mockReturnValue("blob-1");
    const { result } = renderHook(() => useVault());

    await act(async () => {
      await result.current.unlock("master password");
    });

    expect(result.current.status).toBe("unlocked");
    expect(result.current.entries).toEqual(entries);
  });

  it("stays locked and reports a wrong master password", async () => {
    vi.mocked(store.hasVaultBlob).mockReturnValue(true);
    vi.mocked(store.loadVaultBlob).mockReturnValue("blob-1");
    vi.mocked(engine.unlockVault).mockRejectedValue(new engine.WrongPasswordError());
    const { result } = renderHook(() => useVault());

    let outcome = true;
    await act(async () => {
      outcome = await result.current.unlock("wrong");
    });

    expect(outcome).toBe(false);
    expect(result.current.status).toBe("locked");
    expect(result.current.error).toMatch(/not correct/i);
  });

  it("persists the new blob after a save", async () => {
    vi.mocked(store.hasVaultBlob).mockReturnValue(true);
    vi.mocked(store.loadVaultBlob).mockReturnValue("blob-1");
    const { result } = renderHook(() => useVault());
    await act(async () => {
      await result.current.unlock("master password");
    });

    await act(async () => {
      await result.current.save({
        id: "a",
        nickname: "web",
        host: "10.0.0.4",
        port: 22,
        username: "deploy",
      });
    });

    expect(store.saveVaultBlob).toHaveBeenCalledWith("blob-2");
    expect(result.current.entries).toEqual(entries);
  });

  // A failed write must not leave the UI showing entries that were not saved.
  it("reports a full storage quota without losing the error", async () => {
    vi.mocked(store.hasVaultBlob).mockReturnValue(true);
    vi.mocked(store.loadVaultBlob).mockReturnValue("blob-1");
    vi.mocked(store.saveVaultBlob).mockImplementation(() => {
      throw new store.StorageFullError();
    });
    const { result } = renderHook(() => useVault());
    await act(async () => {
      await result.current.unlock("master password");
    });

    let outcome = true;
    await act(async () => {
      outcome = await result.current.save({
        id: "a",
        nickname: "web",
        host: "h",
        port: 22,
        username: "u",
      });
    });

    expect(outcome).toBe(false);
    expect(result.current.error).toMatch(/storage is full/i);
    expect(engine.lockVault).toHaveBeenCalled();
    expect(result.current.status).toBe("locked");
    expect(result.current.entries).toEqual([]);
  });

  it("removes an entry", async () => {
    vi.mocked(store.hasVaultBlob).mockReturnValue(true);
    vi.mocked(store.loadVaultBlob).mockReturnValue("blob-1");
    const { result } = renderHook(() => useVault());
    await act(async () => {
      await result.current.unlock("master password");
    });

    await act(async () => {
      await result.current.remove("a");
    });

    expect(engine.deleteEntry).toHaveBeenCalledWith("a");
    expect(result.current.entries).toEqual([]);
  });

  it("manually locks and clears entries without deleting the stored vault", async () => {
    vi.mocked(store.hasVaultBlob).mockReturnValue(true);
    vi.mocked(store.loadVaultBlob).mockReturnValue("blob-1");
    const { result } = renderHook(() => useVault());
    await act(async () => {
      await result.current.unlock("master password");
    });

    await act(async () => {
      await result.current.lock();
    });

    expect(engine.lockVault).toHaveBeenCalled();
    expect(store.clearVaultBlob).not.toHaveBeenCalled();
    expect(result.current.status).toBe("locked");
    expect(result.current.entries).toEqual([]);
  });

  it("wipes the unlocked engine before clearing a stored vault", async () => {
    vi.mocked(store.hasVaultBlob).mockReturnValue(true);
    vi.mocked(store.loadVaultBlob).mockReturnValue("blob-1");
    const { result } = renderHook(() => useVault());

    await act(async () => {
      await result.current.reset();
    });

    expect(engine.lockVault).toHaveBeenCalled();
    expect(store.clearVaultBlob).toHaveBeenCalled();
    expect(result.current.status).toBe("absent");
    expect(result.current.entries).toEqual([]);
  });

  it("marks itself busy while a slow derivation runs", async () => {
    vi.mocked(store.hasVaultBlob).mockReturnValue(true);
    let release: (value: { blob: string; entries: typeof entries }) => void = () => {};
    vi.mocked(engine.unlockVault).mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    vi.mocked(store.loadVaultBlob).mockReturnValue("blob-1");
    const { result } = renderHook(() => useVault());

    act(() => {
      void result.current.unlock("master password");
    });
    await waitFor(() => expect(result.current.busy).toBe(true));

    await act(async () => {
      release({ blob: "blob-1", entries });
    });
    await waitFor(() => expect(result.current.busy).toBe(false));
  });

  it("yields a frame before invoking the wasm engine", async () => {
    let paint: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      paint = callback;
      return 0;
    });
    vi.mocked(store.hasVaultBlob).mockReturnValue(true);
    vi.mocked(store.loadVaultBlob).mockReturnValue("blob-1");
    const { result } = renderHook(() => useVault());

    let pending: Promise<boolean>;
    act(() => {
      pending = result.current.unlock("master password");
    });

    expect(result.current.busy).toBe(true);
    expect(engine.unlockVault).not.toHaveBeenCalled();

    await act(async () => {
      paint?.(0);
      await pending;
    });

    expect(engine.unlockVault).toHaveBeenCalledWith("blob-1", "master password");
  });
});
