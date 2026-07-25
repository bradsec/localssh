import { describe, expect, it } from "vitest";
import { loadKnownHosts, trustHostKey } from "./knownHostsStore.js";

describe("known hosts store", () => {
  it("persists and reloads trusted fingerprints", async () => {
    await trustHostKey("192.168.1.50:22", "SHA256:abc123");

    const hosts = await loadKnownHosts();

    expect(hosts.get("192.168.1.50:22")).toBe("SHA256:abc123");
  });
});
