import type { HelpTopicId } from "./helpTopics.js";

// Maps the raw text of a failed or dropped connection to the copy deck's
// error variants (docs/repo-health/05-uxwriter.md). The raw text comes from
// three places, and these phrases are the contract with each:
//   - engine/wsconn: "could not reach the relay" for a refused or failed
//     WebSocket upgrade, and "relay connection closed: <reason>" after it.
//   - relay/src/local-relay.ts: the close reasons ("target not allowed",
//     "target host not found", ...).
//   - engine/main.go and golang.org/x/crypto/ssh: "connection lost",
//     "host key rejected", "unable to authenticate".
//
// A browser hides why a WebSocket upgrade failed, so a refused origin, a full
// relay, and a relay that is down arrive as one error. That variant lists all
// three causes rather than guessing one.

export type ConnectionFailureKind =
  | "relay-unreachable"
  | "target-not-allowed"
  | "host-not-found"
  | "timeout"
  | "refused"
  | "auth"
  | "key-invalid"
  | "key-unsupported"
  | "key-passphrase"
  | "key-rejected"
  | "host-key"
  | "connection-lost"
  | "engine-load"
  | "unknown";

export interface ConnectionFailure {
  kind: ConnectionFailureKind;
  message: string;
  recovery: string;
  causes?: { cause: string; fix: string }[];
  topic: HelpTopicId;
}

type Variant = Omit<ConnectionFailure, "kind">;

const VARIANTS: Record<ConnectionFailureKind, Variant> = {
  "relay-unreachable": {
    message: "Could not reach the relay.",
    recovery: "Check the app address and relay logs, then try again. Likely causes:",
    causes: [
      {
        cause: "The relay is not running, or this page is not at the right address.",
        fix: "Check that localssh is running and open its address again.",
      },
      {
        cause: "The relay refused this page's origin.",
        fix: "Add this page's exact address to ALLOWED_ORIGINS in the relay configuration.",
      },
      {
        cause: "The relay reached its session limit.",
        fix: "Close a session you no longer need, or raise MAX_SESSIONS.",
      },
    ],
    topic: "troubleshooting",
  },
  "target-not-allowed": {
    message: "The relay does not allow this host or port.",
    recovery:
      "Connect to an allowed server, or add the host to ALLOWED_HOSTS and the port to ALLOWED_PORTS in the relay configuration.",
    topic: "troubleshooting",
  },
  "host-not-found": {
    message: "The relay could not find this host name.",
    recovery: "Check the spelling of the host, or enter its IP address, then try again.",
    topic: "troubleshooting",
  },
  timeout: {
    message: "The server did not respond.",
    recovery: "Check that the server is on and reachable from the relay, then try again.",
    topic: "troubleshooting",
  },
  refused: {
    message: "The server refused the connection.",
    recovery: "Check the port number and that the SSH service is running, then try again.",
    topic: "troubleshooting",
  },
  auth: {
    message: "SSH login failed.",
    recovery: "Check the username and password, then try again.",
    topic: "troubleshooting",
  },
  "key-invalid": {
    message: "This private key could not be read. Select a supported key file and try again.",
    recovery:
      "Use an OpenSSH Ed25519, ECDSA, or RSA key, an unencrypted PKCS#8 PEM key, or a legacy RSA or EC PEM key.",
    topic: "troubleshooting",
  },
  "key-unsupported": {
    message: "This key format is not supported. Select a supported private key format.",
    recovery: "This key format is not supported. Convert it with: ssh-keygen -p -f <keyfile>",
    topic: "troubleshooting",
  },
  "key-passphrase": {
    message: "The key passphrase did not unlock this key. Check the passphrase and try again.",
    recovery: "Enter the passphrase for this private key, then try again.",
    topic: "troubleshooting",
  },
  "key-rejected": {
    message: "The server did not accept this key.",
    recovery:
      "Check that its public key is in ~/.ssh/authorized_keys on the server, or use password login.",
    topic: "troubleshooting",
  },
  "host-key": {
    message: "The host key was not accepted, so the connection stopped.",
    recovery: "Check the host key with the server administrator, then connect again.",
    topic: "host-key",
  },
  "connection-lost": {
    message: "The connection to the server was lost.",
    recovery: "Check your network connection, then connect again.",
    topic: "troubleshooting",
  },
  "engine-load": {
    message: "Could not load the SSH engine.",
    recovery: "Reload the page and try again.",
    topic: "troubleshooting",
  },
  unknown: {
    message: "Connection failed.",
    recovery: "Check the connection details and try again.",
    topic: "troubleshooting",
  },
};

// Checked in order: the first match wins. Specific causes come before the
// generic "relay connection closed", which ends every post-upgrade failure.
const PATTERNS: [RegExp, ConnectionFailureKind][] = [
  [/host key rejected/, "host-key"],
  [/private key rejected by server/, "key-rejected"],
  [/private key format not supported/, "key-unsupported"],
  [/key passphrase did not unlock the key/, "key-passphrase"],
  [/private key could not be read/, "key-invalid"],
  [/unable to authenticate/, "auth"],
  [/target not allowed/, "target-not-allowed"],
  [/target host not found/, "host-not-found"],
  [/target connection refused/, "refused"],
  [/target connection timeout|target host unreachable|context deadline exceeded/, "timeout"],
  [/could not reach the relay/, "relay-unreachable"],
  [/Could not load the SSH engine/, "engine-load"],
  [/^connection lost|relay connection closed|target connection error/, "connection-lost"],
];

export function describeConnectionFailure(raw: string): ConnectionFailure {
  const kind = PATTERNS.find(([pattern]) => pattern.test(raw))?.[1] ?? "unknown";
  return { kind, ...VARIANTS[kind] };
}

export function describeSftpFailure(
  raw: string,
  remotePath: string,
  filename: string,
): ConnectionFailure {
  if (/permission denied|SSH_FX_PERMISSION_DENIED/i.test(raw)) {
    return {
      kind: "unknown",
      message: `Cannot open ${remotePath}: permission denied. Check access on the server.`,
      recovery: "",
      topic: "files",
    };
  }
  if (/no such file|not exist|SSH_FX_NO_SUCH_FILE/i.test(raw)) {
    return {
      kind: "unknown",
      message: `Cannot open ${remotePath}: no such file. Check the remote path.`,
      recovery: "",
      topic: "files",
    };
  }
  if (/no space left|disk full|quota exceeded/i.test(raw)) {
    return {
      kind: "unknown",
      message: `Transfer of ${filename} stopped: disk full. Free space on the server and try again.`,
      recovery: "",
      topic: "files",
    };
  }
  if (/file connection is closed|SFTP closed|connection closed/i.test(raw)) {
    return {
      kind: "unknown",
      message:
        "Files is no longer connected. Close Files and select Files again, or reconnect the tab.",
      recovery: "",
      topic: "files",
    };
  }
  if (/transfer cancelled/i.test(raw)) {
    return {
      kind: "unknown",
      message: `Transfer of ${filename} stopped: transfer cancelled.`,
      recovery: "",
      topic: "files",
    };
  }
  return {
    kind: "unknown",
    message: `Transfer of ${filename} stopped: ${raw}. Try again after checking the connection.`,
    recovery: "",
    topic: "files",
  };
}
