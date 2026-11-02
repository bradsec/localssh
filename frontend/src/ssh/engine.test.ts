import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectSession,
  FilesClosedError,
  guardSftp,
  instantiateEngine,
  openFiles,
  REMOTE_FILE_CHANGED,
} from "./engine.js";
import type { SftpHandle } from "./engine.js";
import * as engineModule from "./engine.js";

const sshConnect = vi.fn();

beforeEach(() => {
  sshConnect.mockReset();
  sshConnect.mockResolvedValue({ write: vi.fn(), resize: vi.fn(), close: vi.fn() });
  Object.defineProperty(window, "sshConnect", { value: sshConnect, configurable: true });
  // loadEngine fetches the wasm module, which jsdom cannot do. The seam
  // below stands in for a loaded engine; vi.mock cannot intercept the
  // same-module call from connectSession to loadEngine.
  engineModule.loadEngineImpl.current = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no network in tests")));
});

afterEach(() => vi.restoreAllMocks());

const base = {
  relayWsUrl: "ws://relay.test/ws",
  host: "10.0.0.4",
  port: 22,
  username: "deploy",
  isTrustedFingerprint: () => true,
  onData: () => {},
  onClose: () => {},
};

describe("connectSession", () => {
  it("passes the chosen grace and transport status details to WASM", async () => {
    const onTransportStatus = vi.fn();
    await connectSession({
      ...base,
      password: { kind: "typed", value: "secret" },
      keepAliveMs: null,
      onTransportStatus,
    });
    const callbacks = sshConnect.mock.calls[0]?.[5];
    expect(callbacks.keepAliveMs).toBeNull();
    callbacks.onTransportStatus("connected", { grantedGraceMs: null, capGraceMs: null });
    expect(onTransportStatus).toHaveBeenCalledWith("connected", {
      grantedGraceMs: null,
      capGraceMs: null,
    });
  });
  it("passes a key to WASM and wipes it after success", async () => {
    const privateKey = new Uint8Array([1, 2, 3]);
    await connectSession({ ...base, password: { kind: "key", privateKey, passphrase: "secret" } });
    expect(sshConnect.mock.calls[0]?.[4]).toEqual({
      privateKey: expect.any(Uint8Array),
      passphrase: "secret",
    });
    expect(privateKey).toEqual(new Uint8Array(3));
  });

  it("keeps a key for host-key retry", async () => {
    const privateKey = new Uint8Array([1, 2, 3]);
    sshConnect.mockImplementationOnce(async (...args: unknown[]) => {
      const callbacks = args[5] as { onHostKey: (fingerprint: string) => boolean };
      callbacks.onHostKey("SHA256:test");
      throw "host key rejected";
    });
    await expect(
      connectSession({
        ...base,
        password: { kind: "key", privateKey, passphrase: "" },
        isTrustedFingerprint: () => false,
      }),
    ).rejects.toThrow("not trusted");
    expect(privateKey).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("wipes a key when the engine cannot load", async () => {
    const privateKey = new Uint8Array([1, 2, 3]);
    engineModule.loadEngineImpl.current = vi.fn().mockRejectedValue(new Error("load failed"));
    await expect(
      connectSession({ ...base, password: { kind: "key", privateKey, passphrase: "" } }),
    ).rejects.toThrow("load failed");
    expect(Array.from(privateKey)).toEqual([0, 0, 0]);
  });
  it("passes a typed password through as a string", async () => {
    await connectSession({ ...base, password: { kind: "typed", value: "hunter2" } });

    expect(sshConnect).toHaveBeenCalledWith(
      "ws://relay.test/ws",
      "10.0.0.4",
      "22",
      "deploy",
      "hunter2",
      expect.any(Object),
    );
  });

  // The saved password never exists on this side of the boundary, so the
  // engine is handed a reference and resolves it internally.
  it("passes a saved password as a vault reference", async () => {
    await connectSession({ ...base, password: { kind: "vault", entryId: "entry-a" } });

    expect(sshConnect).toHaveBeenCalledWith(
      "ws://relay.test/ws",
      "10.0.0.4",
      "22",
      "deploy",
      { fromVault: "entry-a" },
      expect.any(Object),
    );
  });
});

describe("instantiateEngine", () => {
  it("rejects an unsuccessful HTTP response before compilation", async () => {
    const streaming = vi.spyOn(WebAssembly, "instantiateStreaming");
    const response = new Response("not found", { status: 404 });

    await expect(instantiateEngine(response, {})).rejects.toThrow("HTTP 404");
    expect(streaming).not.toHaveBeenCalled();
  });

  it("falls back to buffered compilation when streaming rejects the MIME type", async () => {
    const instance = {} as WebAssembly.Instance;
    const streaming = vi
      .spyOn(WebAssembly, "instantiateStreaming")
      .mockRejectedValue(new TypeError("unsupported MIME type"));
    const buffered = vi.spyOn(WebAssembly, "instantiate").mockImplementation(
      async () =>
        ({
          instance,
          module: {} as WebAssembly.Module,
        }) as never,
    );
    const response = new Response(new Uint8Array([0, 97, 115, 109]));

    await expect(instantiateEngine(response, {})).resolves.toBe(instance);
    expect(streaming).toHaveBeenCalledOnce();
    expect(buffered).toHaveBeenCalledOnce();
  });

  it("does not hide non-MIME streaming failures", async () => {
    vi.spyOn(WebAssembly, "instantiateStreaming").mockRejectedValue(new Error("invalid module"));
    const buffered = vi.spyOn(WebAssembly, "instantiate");
    const response = new Response(new Uint8Array([0]));

    await expect(instantiateEngine(response, {})).rejects.toThrow("invalid module");
    expect(buffered).not.toHaveBeenCalled();
  });
});

describe("guardSftp", () => {
  // A call through a released engine function returns undefined.
  const released = (): SftpHandle =>
    ({
      list: vi.fn().mockReturnValue(undefined),
      upload: vi.fn().mockReturnValue(undefined),
      download: vi.fn().mockReturnValue(undefined),
      cancel: vi.fn(),
      close: vi.fn(),
    }) as unknown as SftpHandle;

  it("rejects calls made after the engine released the handle", async () => {
    const files = guardSftp(released());
    await expect(files.list(".")).rejects.toBeInstanceOf(FilesClosedError);
    await expect(files.upload("a", new File([], "a"), false, () => {})).rejects.toBeInstanceOf(
      FilesClosedError,
    );
    await expect(
      files.download(
        "a",
        async () => {},
        () => {},
      ),
    ).rejects.toBeInstanceOf(FilesClosedError);
  });

  it("passes results and engine errors through", async () => {
    const listing = { path: "/srv", entries: [] };
    const files = guardSftp({
      ...released(),
      list: vi.fn().mockResolvedValue(listing),
      upload: vi.fn().mockRejectedValue("remote file exists"),
    });
    await expect(files.list("/srv")).resolves.toBe(listing);
    await expect(files.upload("a", new File([], "a"), false, () => {})).rejects.toBe(
      "remote file exists",
    );
  });

  it("passes download resume options to the engine", async () => {
    const download = vi.fn().mockResolvedValue({ grew: false, size: 9 });
    const files = guardSftp({ ...released(), download });
    const onChunk = async () => {};
    const onProgress = () => {};
    const opts = {
      offset: 4,
      expectSize: 9,
      expectMtime: 1000,
      tail: new Uint8Array([1, 2, 3, 4]),
      onStart: () => {},
    };
    await expect(files.download("a", onChunk, onProgress, opts)).resolves.toEqual({
      grew: false,
      size: 9,
    });
    expect(download).toHaveBeenCalledWith("a", onChunk, onProgress, opts);
    await files.download("a", onChunk, onProgress);
    expect(download).toHaveBeenLastCalledWith("a", onChunk, onProgress);
    expect(REMOTE_FILE_CHANGED).toBe("remote file changed");
  });

  it("rejects opening files on a released session handle", async () => {
    const handle = {
      write: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
      openFiles: vi.fn(),
    };
    await expect(openFiles(handle)).rejects.toBeInstanceOf(FilesClosedError);
    await expect(openFiles({ write: vi.fn(), resize: vi.fn(), close: vi.fn() })).rejects.toThrow(
      "SFTP is unavailable",
    );
  });
});
