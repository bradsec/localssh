import { describe, expect, it, vi } from "vitest";
import { capabilitiesUrl, fetchRelayCapabilities } from "./relayCapabilities.js";

describe("relay capabilities", () => {
  it.each([
    ["ws://h/relay", "http://h/relay/capabilities"],
    ["wss://h:8443/relay", "https://h:8443/relay/capabilities"],
    ["ws://h:8787", "http://h:8787/capabilities"],
  ])("maps %s to %s", (input, expected) => {
    expect(capabilitiesUrl(input)).toBe(expected);
  });

  it("reads a valid capability response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ protocols: [1, 2], resume: true, maxGraceMs: 600000 }),
    });
    await expect(fetchRelayCapabilities("ws://h/relay", fetchImpl)).resolves.toEqual({
      resume: true,
      maxGraceMs: 600000,
    });
  });

  it.each([
    { ok: false, status: 404 },
    { ok: true, json: async () => ({ resume: true, maxGraceMs: "bad" }) },
    {
      ok: true,
      json: async () => {
        throw new SyntaxError("bad JSON");
      },
    },
  ])("returns unknown for an invalid response", async (response) => {
    await expect(
      fetchRelayCapabilities("ws://h", vi.fn().mockResolvedValue(response)),
    ).resolves.toBe("unknown");
  });

  it("returns unknown when CORS rejects the request", async () => {
    await expect(
      fetchRelayCapabilities("ws://h", vi.fn().mockRejectedValue(new TypeError("CORS"))),
    ).resolves.toBe("unknown");
  });

  it("abandons a capability request after 5 seconds", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(
        (_url: string, options: RequestInit) =>
          new Promise<never>((_resolve, reject) => {
            options.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      );
      const result = fetchRelayCapabilities("ws://h", fetchImpl as typeof fetch);
      await vi.advanceTimersByTimeAsync(5000);
      await expect(result).resolves.toBe("unknown");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
