import { useRef, useState, type FormEvent } from "react";
import { APP_VERSION } from "../appVersion.js";
import { SavedHosts } from "./SavedHosts.js";
import type { VaultApi } from "../vault/useVault.js";
import type { SavedEntry } from "../vault/vaultEngine.js";
import type { ConnectPassword } from "../ssh/engine.js";

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

export function ConnectDialog({ vault, onConnect, disabled }: ConnectDialogProps) {
  const [migrated] = useState(migrateLastHost);
  const [host, setHost] = useState(migrated?.host ?? "");
  const [port, setPort] = useState(String(migrated?.port ?? 22));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const storesAPassword = vault.entries.some((entry) => entry.hasPassword);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
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

  return (
    <section className="connect-panel" aria-labelledby="connect-title">
      <div className="connect-panel__intro">
        <p className="connect-kicker">New session</p>
        <h1 id="connect-title">Connect to your server</h1>
        <p>Open a secure SSH terminal without sending credentials to an application server.</p>
        <div className="privacy-note">
          {vault.status === "locked" ? (
            <>
              <strong>Saved hosts are locked</strong>
              <span>Enter your master password to view them.</span>
            </>
          ) : vault.status === "unavailable" ? (
            <>
              <strong>Saved hosts are unavailable</strong>
              <span>Browser storage is unavailable on this device.</span>
            </>
          ) : storesAPassword ? (
            <>
              <strong>Saved passwords on this device</strong>
              <span>
                A saved password is encrypted in this browser under your master password and is
                never sent anywhere. Typed passwords stay in memory for the connection only.
              </span>
            </>
          ) : null}
        </div>
        <p className="connect-version">Version {APP_VERSION}</p>
      </div>

      <SavedHosts
        vault={vault}
        current={{ host, port: Number(port), username }}
        disabled={disabled}
        onPick={handlePick}
      />

      <form className="connect-form" onSubmit={handleSubmit}>
        <h2>Connection details</h2>
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
        <button
          className="button button--primary connect-form__submit"
          type="submit"
          disabled={disabled}
        >
          {disabled ? "Connecting..." : "Connect"}
        </button>
      </form>
    </section>
  );
}
