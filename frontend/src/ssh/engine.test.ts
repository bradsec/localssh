import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectSession, instantiateEngine } from "./engine.js";
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
