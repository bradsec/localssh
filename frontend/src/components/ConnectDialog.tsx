import { useState, type FormEvent } from "react";
import {
  loadLastHost,
  loadRememberHost,
  saveLastHost,
  saveRememberHost,
} from "../storage/lastHostStore.js";
import { APP_VERSION } from "../appVersion.js";

export interface ConnectFormValues {
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface ConnectDialogProps {
  onConnect: (values: ConnectFormValues) => void;
  disabled: boolean;
}

export function ConnectDialog({ onConnect, disabled }: ConnectDialogProps) {
  const [remembered] = useState(() => loadLastHost());
  const [host, setHost] = useState(remembered?.host ?? "");
  const [port, setPort] = useState(String(remembered?.port ?? 22));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberHost, setRememberHost] = useState(() => loadRememberHost());

  function handleRememberChange(enabled: boolean) {
    setRememberHost(enabled);
    saveRememberHost(enabled);
    if (enabled) saveLastHost({ host, port: Number(port) });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    saveLastHost({ host, port: Number(port) });
    onConnect({ host, port: Number(port), username, password });
  }

  return (
    <section className="connect-panel" aria-labelledby="connect-title">
      <div className="connect-panel__intro">
        <p className="connect-kicker">New session</p>
        <h1 id="connect-title">Connect to your server</h1>
        <p>Open a secure SSH terminal without sending credentials to an application server.</p>
        <div className="privacy-note">
          <strong>Private by design</strong>
          <span>Your password stays in memory for this connection only.</span>
        </div>
        <p className="connect-version">localssh {APP_VERSION}</p>
      </div>

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
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label className="field connect-form__password">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <label className="switch connect-form__remember">
          <input
            type="checkbox"
            checked={rememberHost}
            onChange={(event) => handleRememberChange(event.target.checked)}
          />
          <span className="switch__track" aria-hidden="true" />
          <span className="switch__text">
            Remember this host
            <small>Saves the host and port only, never your username or password.</small>
          </span>
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
