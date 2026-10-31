import { describe, expect, it } from "vitest";
import { describeConnectionFailure } from "./connectionErrors.js";

// Raw strings as the engine and relay produce them, so a change on either side
// that breaks the mapping fails here.
describe("describeConnectionFailure", () => {
  it.each([
    [
      "could not reach the relay: it may be down, or it refused this page's origin (check ALLOWED_ORIGINS in the relay configuration, and the relay log for the reason)",
      "relay-unreachable",
      "troubleshooting",
    ],
    [
      "ssh handshake: ssh: handshake failed: relay connection closed: target not allowed (code 1008)",
      "target-not-allowed",
      "troubleshooting",
    ],
    [
      "ssh handshake: ssh: handshake failed: relay connection closed: target host not found (code 1011)",
      "host-not-found",
      "troubleshooting",
    ],
    [
      "ssh handshake: ssh: handshake failed: relay connection closed: target connection timeout (code 1011)",
      "timeout",
      "troubleshooting",
    ],
    [
      "ssh handshake: ssh: handshake failed: relay connection closed: target host unreachable (code 1011)",
      "timeout",
      "troubleshooting",
    ],
    ["context deadline exceeded", "timeout", "troubleshooting"],
    [
      "ssh handshake: ssh: handshake failed: relay connection closed: target connection refused (code 1011)",
      "refused",
      "troubleshooting",
    ],
    [
      "ssh handshake: ssh: handshake failed: ssh: unable to authenticate, attempted methods [none password], no supported methods remain",
      "auth",
      "troubleshooting",
    ],
    ["ssh handshake: ssh: handshake failed: host key rejected", "host-key", "host-key"],
    ["connection lost", "connection-lost", "troubleshooting"],
    ["connection lost: relay connection closed (code 1006)", "connection-lost", "troubleshooting"],
    [
      "ssh handshake: ssh: handshake failed: relay connection closed: target connection error (code 1011)",
      "connection-lost",
      "troubleshooting",
    ],
    ["Could not load the SSH engine (HTTP 404).", "engine-load", "troubleshooting"],
    ["something unexpected", "unknown", "troubleshooting"],
  ])("maps %j to %s", (raw, kind, topic) => {
    const failure = describeConnectionFailure(raw);
    expect(failure.kind).toBe(kind);
    expect(failure.topic).toBe(topic);
    expect(failure.message).not.toBe("");
    expect(failure.recovery).not.toBe("");
  });

  it("lists the pre-upgrade causes it cannot tell apart, each with a fix", () => {
    const failure = describeConnectionFailure("could not reach the relay: it may be down");
    expect(failure.message).toBe("Could not reach the relay.");
    expect(failure.causes?.map(({ cause, fix }) => `${cause} ${fix}`)).toEqual([
      expect.stringMatching(/not running.*right address/),
      expect.stringMatching(/origin.*ALLOWED_ORIGINS/),
      expect.stringMatching(/session limit.*MAX_SESSIONS/),
    ]);
  });

  it("matches a relay reason, not a host name that contains one", () => {
    // A host name is never in a close reason, but it can appear in other raw
    // text; the mapping keys on the exact reason phrases.
    expect(describeConnectionFailure('invalid port "refused"').kind).toBe("unknown");
  });

  it.each([
    ["private key could not be read", "key-invalid"],
    ["private key format not supported", "key-unsupported"],
    ["key passphrase did not unlock the key", "key-passphrase"],
    ["private key rejected by server: unable to authenticate", "key-rejected"],
  ])("maps %s to %s", (raw, kind) => {
    const failure = describeConnectionFailure(raw);
    expect(failure.kind).toBe(kind);
    expect(failure.topic).toBe("troubleshooting");
  });

  it("offers conversion for unsupported private keys", () => {
    const failure = describeConnectionFailure("private key format not supported");
    expect(failure.recovery).toBe(
      "This key format is not supported. Convert it with: ssh-keygen -p -f <keyfile>",
    );
  });
});
