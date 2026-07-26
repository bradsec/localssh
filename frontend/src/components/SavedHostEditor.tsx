import { useState, type FormEvent } from "react";
import type { EntryInput, SavedEntry } from "../vault/vaultEngine.js";

/**
 * How much of a target an entry keeps. The level is not persisted: it is
 * derived from which fields an entry has, so it cannot drift from the data.
 */
export type SaveLevel = "host" | "user" | "password";

const SAVE_LEVELS = [
  {
    value: "host",
    label: "Host only",
    shortLabel: "Host",
    detail: "Save the host and port.",
  },
  {
    value: "user",
    label: "Host and username",
    shortLabel: "+ Username",
    detail: "Save the host, port and username.",
  },
  {
    value: "password",
    label: "Host, username and password, stored encrypted in this browser",
    shortLabel: "+ Password",
    detail: "Save everything. The password is encrypted in this browser.",
  },
] as const;

export interface SavedHostEditorProps {
  entry: SavedEntry | null;
  initial?: { host: string; port: number; username: string };
  busy: boolean;
  onSave: (input: EntryInput) => void;
  onCancel: () => void;
}

function levelOf(entry: SavedEntry | null): SaveLevel {
  if (entry === null) return "host";
  if (entry.hasPassword) return "password";
  return entry.username ? "user" : "host";
}

function newId(): string {
  // randomUUID is unavailable in insecure contexts, which is the deployment
  // this application documents. getRandomValues is not gated.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function SavedHostEditor({ entry, initial, busy, onSave, onCancel }: SavedHostEditorProps) {
  const [level, setLevel] = useState<SaveLevel>(() => levelOf(entry));
  const [nickname, setNickname] = useState(entry?.nickname ?? "");
  const [host, setHost] = useState(entry?.host ?? initial?.host ?? "");
  const [port, setPort] = useState(String(entry?.port ?? initial?.port ?? 22));
  const [username, setUsername] = useState(entry?.username ?? initial?.username ?? "");
  const [password, setPassword] = useState("");

  const hadPassword = entry?.hasPassword ?? false;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const input: EntryInput = {
      id: entry?.id ?? newId(),
      nickname: nickname.trim(),
      host: host.trim(),
      port: Number(port),
      username: level === "host" ? "" : username.trim(),
    };

    // An absent password keeps whatever is saved. It is set explicitly only to
    // record a new one, or to clear one the user has just chosen to drop.
    if (level === "password" && password !== "") {
      input.password = password;
    } else if (level !== "password" && hadPassword) {
      input.password = "";
    }

    onSave(input);
  }

  return (
    <form className="saved-host-editor" onSubmit={handleSubmit}>
      <h3>{entry === null ? "Add a saved host" : "Edit saved host"}</h3>

      <label className="field">
        <span>Nickname</span>
        <input
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
          autoComplete="off"
          maxLength={128}
          placeholder="web-prod"
          required
        />
      </label>

      <label className="field">
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

      <label className="field">
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

      <fieldset className="saved-host-editor__level">
        <legend>What to save</legend>
        <div className="saved-host-editor__segments">
          {SAVE_LEVELS.map(({ value, label, shortLabel }) => (
            <label className="saved-host-editor__segment" key={value}>
              <input
                type="radio"
                name="save-level"
                value={value}
                checked={level === value}
                onChange={() => setLevel(value)}
              />
              <span>
                <span className="visually-hidden">{label}</span>
                <span aria-hidden="true">{shortLabel}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="saved-host-editor__level-detail">
          {SAVE_LEVELS.find(({ value }) => value === level)?.detail}
        </p>
      </fieldset>

      {level !== "host" && (
        <label className="field">
          <span>Username</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
          />
        </label>
      )}

      {level === "password" && (
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            required={!hadPassword}
          />
          {hadPassword && <small>Leave blank to keep the saved password.</small>}
        </label>
      )}

      <div className="saved-host-editor__actions">
        <button className="button" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="button button--primary" type="submit" disabled={busy}>
          {busy ? "Saving..." : "Save"}
        </button>
      </div>
    </form>
  );
}
