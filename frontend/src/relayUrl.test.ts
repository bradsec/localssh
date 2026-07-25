import { describe, expect, it } from "vitest";
import { resolveRelayWsUrl } from "./relayUrl.js";

describe("resolveRelayWsUrl", () => {
  it("uses the configured URL when present", () => {
    expect(
      resolveRelayWsUrl("wss://relay.example/ws", {
        protocol: "https:",
        host: "localssh.example",
      }),
    ).toBe("wss://relay.example/ws");
  });

  it("uses the browser-visible host for an HTTP page", () => {
    expect(
      resolveRelayWsUrl(undefined, {
        protocol: "http:",
        host: "192.168.1.20:9080",
      }),
    ).toBe("ws://192.168.1.20:9080/relay");
  });

  it("uses a secure WebSocket for an HTTPS page", () => {
    expect(
      resolveRelayWsUrl("", {
        protocol: "https:",
        host: "localssh.example",
      }),
    ).toBe("wss://localssh.example/relay");
  });
});
