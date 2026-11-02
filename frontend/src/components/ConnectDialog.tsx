import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { SavedHosts } from "./SavedHosts.js";
import type { VaultApi } from "../vault/useVault.js";
import type { SavedEntry } from "../vault/vaultEngine.js";
import type { ConnectPassword } from "../ssh/engine.js";

/** Private keys are a few KiB; a larger input is a mistake and would exhaust memory. */
const MAX_KEY_BYTES = 64 * 1024;

export interface ConnectFormValues {
  host: string;
  port: number;
  username: string;
  password: ConnectPassword;
}

export interface ConnectDialogProps {
  vault: VaultApi;
  onConnect: (values: ConnectFormValues) => void;
  disabled: boolean;
  /** Why the last connection failed, shown under the connect action. */
  error?: ReactNode;
  /** Address of a closed terminal being reconnected. Credentials are never prefilled. */
  initialValues?: { host: string; port: number; username: string };
}

/**
 * Reads and removes the plaintext host memory kept by versions before the
 * address book. Its one remaining job is to pre-fill the form once.
 */
function migrateLastHost(): { host: string; port: number } | null {
  try {
    const enabled = localStorage.getItem("rememberLastHost") === "true";
    const raw = localStorage.getItem("lastHost");
    localStorage.removeItem("lastHost");
    localStorage.removeItem("rememberLastHost");
    if (!enabled || !raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;

    const { host, port } = parsed as Record<string, unknown>;
    if (typeof host !== "string" || host === "") return null;
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
      return null;
    }
    return { host, port };
  } catch {
    return null;
  }
}

export function ConnectDialog({
  vault,
  onConnect,
  disabled,
  error,
  initialValues,
}: ConnectDialogProps) {
  const [migrated] = useState(migrateLastHost);
  const [host, setHost] = useState(initialValues?.host ?? migrated?.host ?? "");
  const [port, setPort] = useState(String(initialValues?.port ?? migrated?.port ?? 22));
  const [username, setUsername] = useState(initialValues?.username ?? "");
  const [password, setPassword] = useState("");
  const [method, setMethod] = useState<"password" | "key">("password");
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [pastedKey, setPastedKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [readingKey, setReadingKey] = useState(false);
  const [keyError, setKeyError] = useState("");
  const keyFileRef = useRef<HTMLInputElement>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // A reconnect lands on the first credential still missing (S-17). Mount only:
  // the caller remounts the form for each reconnect.
  const [initialFocus] = useState(() =>
    initialValues ? (initialValues.username ? passwordRef : usernameRef) : null,
  );
  useEffect(() => initialFocus?.current?.focus(), [initialFocus]);

  const storesAPassword = vault.entries.some((entry) => entry.hasPassword);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (method === "key") {
      if (!pastedKey && !keyFile) {
        setKeyError("Select a private-key file or paste the private key.");
        return;
      }
      setReadingKey(true);
      setKeyError("");
      try {
        if (!pastedKey && keyFile!.size > MAX_KEY_BYTES) throw new Error("key too large");
        const privateKey = pastedKey
          ? new TextEncoder().encode(pastedKey)
          : new Uint8Array(await keyFile!.arrayBuffer());
        if (privateKey.byteLength > MAX_KEY_BYTES) {
          privateKey.fill(0);
          throw new Error("key too large");
        }
        onConnect({
          host,
          port: Number(port),
          username,
          password: { kind: "key", privateKey, passphrase },
        });
        setPastedKey("");
        setPassphrase("");
        setKeyFile(null);
        if (keyFileRef.current) keyFileRef.current.value = "";
      } catch {
        setKeyError(
          "This private key could not be read. Select a supported key file and try again.",
        );
      } finally {
        setReadingKey(false);
      }
      return;
    }
    onConnect({
      host,
      port: Number(port),
      username,
      password: { kind: "typed", value: password },
    });
  }

  // A saved password is referenced, never fetched: it does not exist on this
  // side of the WebAssembly boundary.
  function handlePick(entry: SavedEntry) {
    setHost(entry.host);
    setPort(String(entry.port));
    setUsername(entry.username ?? "");
    setPassword("");
    setMethod("password");

    if (entry.username && entry.hasPassword) {
      onConnect({
        host: entry.host,
        port: entry.port,
        username: entry.username,
        password: { kind: "vault", entryId: entry.id },
      });
      return;
    }
    if (entry.username) passwordRef.current?.focus();
    else usernameRef.current?.focus();
  }

  const privacyNote =
    vault.status === "locked" ? (
      <>
        <strong>Saved hosts are locked</strong>
        <span>Enter your master password to view them.</span>
      </>
    ) : vault.status === "unavailable" ? (
      <>
        <strong>Saved hosts are unavailable</strong>
        <span>Allow browser storage to save hosts, or connect without saving.</span>
      </>
    ) : storesAPassword ? (
      <>
        <strong>Saved passwords on this device</strong>
        <span>
          Saved passwords are encrypted in this browser. The SSH server receives your password
          through the encrypted connection. The relay cannot read it.
        </span>
      </>
    ) : null;

  return (
    <section className="connect-panel" aria-labelledby="connect-title">
      <div className="connect-panel__main">
        <h1 id="connect-title">Connect to your server</h1>
        <form className="connect-form" onSubmit={handleSubmit}>
          <label className="field connect-form__host">
            <span>Host</span>
            <input
              value={host}
              onChange={(event) => setHost(event.target.value)}
              autoComplete="off"
              inputMode="url"
              placeholder="server.example.com"
              required
            />
          </label>
          <label className="field connect-form__port">
            <span>Port</span>
            <input
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(event) => setPort(event.target.value)}
              inputMode="numeric"
              required
            />
          </label>
          <label className="field connect-form__username">
            <span>Username</span>
            <input
              ref={usernameRef}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <fieldset className="connect-form__auth">
            <legend>Authentication method</legend>
            <label>
              <input
                type="radio"
                name="auth-method"
                checked={method === "password"}
                onChange={() => setMethod("password")}
              />
              Password<span className="visually-hidden"> authentication</span>
            </label>
            <label>
              <input
                type="radio"
                name="auth-method"
                checked={method === "key"}
                onChange={() => setMethod("key")}
              />
              Private key
            </label>
          </fieldset>
          {method === "password" ? (
            <label className="field connect-form__password">
              <span>Password</span>
              <input
                ref={passwordRef}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
          ) : (
            <>
              <label className="field connect-form__key">
                <span>Private-key file</span>
                <input
                  ref={keyFileRef}
                  type="file"
                  onChange={(event) => setKeyFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <p>
                Select a private key from this device. localssh does not save the key or passphrase.
              </p>
              <p>
                Supported formats: OpenSSH Ed25519, ECDSA, or RSA (passphrase optional); unencrypted
                PKCS#8 PEM; legacy RSA or EC PEM (passphrase optional).
              </p>
              <label className="field connect-form__key">
                <span>Or paste the private key</span>
                <textarea
                  value={pastedKey}
                  onChange={(event) => setPastedKey(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label className="field connect-form__key">
                <span>Key passphrase</span>
                <input
                  type="password"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                  autoComplete="off"
                />
              </label>
              {keyError && <p role="alert">{keyError}</p>}
            </>
          )}
          <button
            className="button button--primary connect-form__submit"
            type="submit"
            disabled={disabled || readingKey}
          >
            {readingKey
              ? "Reading private key..."
              : disabled
                ? "Connecting to server..."
                : "Connect to server"}
          </button>
          {error}
        </form>
        {privacyNote && <div className="privacy-note">{privacyNote}</div>}
      </div>
      <SavedHosts
        vault={vault}
        current={{ host, port: Number(port), username }}
        disabled={disabled}
        onPick={handlePick}
      />
    </section>
  );
}
