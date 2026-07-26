import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Icon } from "./Icon.js";
import { PasswordStrength } from "./PasswordStrength.js";
import { SavedHostEditor } from "./SavedHostEditor.js";
import type { VaultApi } from "../vault/useVault.js";
import type { EntryInput, SavedEntry } from "../vault/vaultEngine.js";

export interface SavedHostsProps {
  vault: VaultApi;
  current: { host: string; port: number; username: string };
  disabled?: boolean;
  onPick: (entry: SavedEntry) => void;
}

const RESET_PHRASE = "DELETE";

export function SavedHosts({ vault, current, disabled = false, onPick }: SavedHostsProps) {
  // Storage is blocked, so there is nothing this card could offer.
  if (vault.status === "unavailable") return null;

  return (
    <section className="saved-hosts" aria-labelledby="saved-hosts-title">
      <div className="saved-hosts__header">
        <h2 id="saved-hosts-title">
          {vault.status === "locked" && <Icon name="lock" size={18} />}
          Saved hosts
        </h2>
        <div className="saved-hosts__header-actions">
          <span className="saved-hosts__status">
            {vault.status === "absent" && "Optional"}
            {vault.status === "locked" && "Locked"}
            {vault.status === "unlocked" &&
              `${vault.entries.length} ${vault.entries.length === 1 ? "host" : "hosts"}`}
          </span>
          {vault.status === "unlocked" && (
            <button
              className="saved-hosts__lock"
              type="button"
              disabled={vault.busy}
              onClick={() => void vault.lock()}
            >
              <Icon name="lock" size={16} />
              Lock
            </button>
          )}
        </div>
      </div>

      {vault.error && (
        <p className="saved-hosts__error" role="alert">
          {vault.error}
        </p>
      )}

      {vault.status === "absent" && <SetupForm vault={vault} />}
      {vault.status === "locked" && <UnlockForm vault={vault} />}
      {vault.status === "unlocked" && (
        <EntryList vault={vault} current={current} disabled={disabled} onPick={onPick} />
      )}
    </section>
  );
}

function SetupForm({ vault }: { vault: VaultApi }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [mismatch, setMismatch] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmation) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    // Paint the pending state before the derivation, which blocks the page's
    // only thread for as long as Argon2id runs.
    await nextFrame();
    await vault.create(password);
  }

  return (
    <form className="saved-hosts__form" onSubmit={handleSubmit}>
      <VaultUsernameField />
      <p className="saved-hosts__lede">
        Set a master password to save hosts for quick connection. It encrypts them in this browser
        and is asked for once each time you open localssh. There is no way to recover it.
      </p>
      <label className="field">
        <span>Master password</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          required
        />
      </label>
      <PasswordStrength password={password} />
      <label className="field">
        <span>Confirm master password</span>
        <input
          type="password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          autoComplete="new-password"
          required
        />
      </label>
      {mismatch && (
        <p className="saved-hosts__error" role="alert">
          Those passwords do not match.
        </p>
      )}
      <button className="button button--primary" type="submit" disabled={vault.busy}>
        {vault.busy ? "Encrypting..." : "Create"}
      </button>
    </form>
  );
}

function UnlockForm({ vault }: { vault: VaultApi }) {
  const [password, setPassword] = useState("");
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [phrase, setPhrase] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await nextFrame();
    if (await vault.unlock(password)) setPassword("");
  }

  return (
    <>
      <form className="saved-hosts__form" onSubmit={handleSubmit}>
        <VaultUsernameField />
        <label className="field">
          <span>Master password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <button className="button button--primary" type="submit" disabled={vault.busy}>
          {vault.busy ? "Unlocking..." : "Unlock"}
        </button>
      </form>

      {!confirmingReset && (
        <button
          className="saved-hosts__link"
          type="button"
          onClick={() => setConfirmingReset(true)}
        >
          Forgotten your master password?
        </button>
      )}

      {confirmingReset && (
        <div className="saved-hosts__reset">
          <p>
            Saved hosts cannot be recovered without the master password. Deleting the vault removes
            every saved host from this browser.
          </p>
          <label className="field">
            <span>Type {RESET_PHRASE} to confirm</span>
            <input
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              autoComplete="off"
            />
          </label>
          <div className="saved-hosts__reset-actions">
            <button className="button" type="button" onClick={() => setConfirmingReset(false)}>
              Cancel
            </button>
            <button
              className="button button--danger"
              type="button"
              disabled={phrase !== RESET_PHRASE}
              onClick={async () => {
                if (await vault.reset()) {
                  setConfirmingReset(false);
                  setPhrase("");
                }
              }}
            >
              Delete the vault
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function EntryList({ vault, current, disabled = false, onPick }: SavedHostsProps) {
  const [editing, setEditing] = useState<SavedEntry | null | undefined>(undefined);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SavedEntry | null>(null);
  const deleteDialogRef = useRef<HTMLDivElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const deleteReturnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!deleting) return;
    deleteCancelRef.current?.focus();

    function trapDeleteFocus(event: globalThis.KeyboardEvent) {
      if (event.key !== "Tab" || !deleteDialogRef.current) return;
      const focusable = deleteDialogRef.current.querySelectorAll<HTMLElement>("button");
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      const active = document.activeElement;
      if (event.shiftKey && (active === first || !deleteDialogRef.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (active === last || !deleteDialogRef.current.contains(active))
      ) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", trapDeleteFocus, true);
    return () => document.removeEventListener("keydown", trapDeleteFocus, true);
  }, [deleting]);

  function closeDeleteDialog() {
    const returnFocus = deleteReturnFocusRef.current;
    setDeleting(null);
    requestAnimationFrame(() => returnFocus?.focus());
  }

  function handleDeleteKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") closeDeleteDialog();
  }

  async function handleSave(input: EntryInput) {
    if (await vault.save(input)) setEditing(undefined);
  }

  if (editing !== undefined) {
    return (
      <SavedHostEditor
        entry={editing}
        initial={editing === null ? current : undefined}
        busy={vault.busy}
        onSave={handleSave}
        onCancel={() => setEditing(undefined)}
      />
    );
  }

  return (
    <>
      {vault.entries.length === 0 && (
        <div className="saved-hosts__empty-state">
          <strong>No saved hosts yet</strong>
          <span>Add the current connection details for quicker access next time.</span>
        </div>
      )}

      <ul className="saved-hosts__list">
        {vault.entries.map((entry) => (
          <li className="saved-hosts__row" key={entry.id}>
            <button
              className="saved-hosts__entry"
              type="button"
              aria-label={`${entry.nickname}: ${
                entry.username ? `${entry.username}@` : ""
              }${entry.host}${entry.port === 22 ? "" : `:${entry.port}`}`}
              disabled={disabled}
              onClick={() => onPick(entry)}
            >
              <span className="saved-hosts__nickname">{entry.nickname}</span>
              <span className="saved-hosts__target">
                {entry.username ? `${entry.username}@` : ""}
                {entry.host}
                {entry.port === 22 ? "" : `:${entry.port}`}
              </span>
            </button>
            {/* Editing and deleting sit behind a menu so that a thumb aiming
                for the row cannot hit them. */}
            <button
              className="saved-hosts__menu-button"
              type="button"
              aria-label={`Options for ${entry.nickname}`}
              aria-expanded={menuFor === entry.id}
              onClick={() => setMenuFor(menuFor === entry.id ? null : entry.id)}
            >
              <Icon name="more_horiz" />
            </button>
            {menuFor === entry.id && (
              <div className="saved-hosts__menu">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(entry);
                    setMenuFor(null);
                  }}
                >
                  <Icon name="edit" size={18} />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    deleteReturnFocusRef.current =
                      event.currentTarget
                        .closest("li")
                        ?.querySelector(".saved-hosts__menu-button") ?? null;
                    setDeleting(entry);
                    setMenuFor(null);
                  }}
                >
                  <Icon name="delete" size={18} />
                  Delete
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {deleting && (
        <div className="dialog-backdrop">
          <div
            ref={deleteDialogRef}
            className="saved-hosts__confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-saved-host-title"
            onKeyDown={handleDeleteKeyDown}
          >
            <p id="delete-saved-host-title">Remove {deleting.nickname} from saved hosts?</p>
            <button
              ref={deleteCancelRef}
              className="button"
              type="button"
              onClick={closeDeleteDialog}
            >
              Cancel
            </button>
            <button
              className="button button--danger"
              type="button"
              onClick={async () => {
                if (await vault.remove(deleting.id)) closeDeleteDialog();
              }}
            >
              Delete {deleting.nickname}
            </button>
          </div>
        </div>
      )}

      <div className="saved-hosts__actions">
        <button className="saved-hosts__add" type="button" onClick={() => setEditing(null)}>
          <Icon name="add" size={18} />
          Add current
        </button>
        <ChangeMasterPassword vault={vault} />
      </div>
    </>
  );
}

function ChangeMasterPassword({ vault }: { vault: VaultApi }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [mismatch, setMismatch] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (next !== confirmation) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    await nextFrame();
    if (await vault.changePassword(current, next)) {
      setOpen(false);
      setCurrent("");
      setNext("");
      setConfirmation("");
    }
  }

  if (!open) {
    return (
      <button className="saved-hosts__link" type="button" onClick={() => setOpen(true)}>
        Change master password
      </button>
    );
  }

  return (
    <form className="saved-hosts__form" onSubmit={handleSubmit}>
      <VaultUsernameField />
      <label className="field">
        <span>Current master password</span>
        <input
          type="password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          autoComplete="current-password"
          required
        />
      </label>
      <label className="field">
        <span>New master password</span>
        <input
          type="password"
          value={next}
          onChange={(event) => setNext(event.target.value)}
          autoComplete="new-password"
          required
        />
      </label>
      <PasswordStrength password={next} />
      <label className="field">
        <span>Confirm new master password</span>
        <input
          type="password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          autoComplete="new-password"
          required
        />
      </label>
      {mismatch && (
        <p className="saved-hosts__error" role="alert">
          Those passwords do not match.
        </p>
      )}
      <div className="saved-host-editor__actions">
        <button className="button" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button className="button button--primary" type="submit" disabled={vault.busy}>
          {vault.busy ? "Re-encrypting..." : "Change"}
        </button>
      </div>
    </form>
  );
}

function VaultUsernameField() {
  return (
    <input
      type="text"
      name="username"
      value="localssh-vault"
      autoComplete="username"
      readOnly
      hidden
    />
  );
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
