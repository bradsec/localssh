import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { KeyBarEditor } from "./KeyBarEditor.js";
import { useHelp } from "../helpContext.js";
import { formatGrace, KEEP_ALIVE_CHOICES } from "../keepAlive.js";
import { fetchRelayCapabilities, type RelayCapabilities } from "../relayCapabilities.js";
import { TERMINAL_FONTS } from "../terminalFonts.js";
import { TERMINAL_THEMES } from "../terminalThemes.js";
import {
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  type TerminalSettings,
} from "../storage/settingsStore.js";
import type { SavedEntry, TerminalPrefs } from "../vault/vaultEngine.js";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  value: TerminalSettings;
  onChange: (next: TerminalSettings) => { ok: boolean };
  savedEntry?: SavedEntry;
  hasSavedHost?: boolean;
  vaultUnlocked?: boolean;
  onSaveHost?: (terminal: TerminalPrefs | null) => Promise<boolean>;
  activeTarget?: string;
  hasOpenTerminals: boolean;
  relayWsUrl: string;
  /** The key bar exists only on a coarse pointer, so only then can it be edited. */
  touchPointer?: boolean;
  /** Keys that fit the key bar row now, from the bar's measurement. */
  keyBarCapacity?: number;
  returnFocusTo: () => HTMLElement | null;
}

const FONT_SIZES = Array.from({ length: 25 }, (_, index) => index + 8);
const LINE_HEIGHTS = Array.from(
  { length: Math.round((LINE_HEIGHT_MAX - LINE_HEIGHT_MIN) * 20) + 1 },
  (_, index) => (LINE_HEIGHT_MIN * 100 + index * 5) / 100,
);

export function SettingsDialog({
  open,
  onClose,
  value,
  onChange,
  savedEntry,
  hasSavedHost = !!savedEntry,
  vaultUnlocked = false,
  onSaveHost,
  activeTarget,
  hasOpenTerminals,
  relayWsUrl,
  touchPointer = false,
  keyBarCapacity,
  returnFocusTo,
}: SettingsDialogProps) {
  const panelRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const returnFocusRef = useRef(returnFocusTo);
  const editKeyBarRef = useRef<HTMLButtonElement>(null);
  const [editingKeyBar, setEditingKeyBar] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [savingHostAppearance, setSavingHostAppearance] = useState(false);
  const [scopeSelection, setScopeSelection] = useState<{
    entryId: string;
    host: boolean;
    draft?: TerminalPrefs;
  } | null>(null);
  const scopeChangeRef = useRef(0);
  const [capabilities, setCapabilities] = useState<RelayCapabilities | "unknown" | null>(null);
  const leftEditor = useRef(false);
  const help = useHelp();

  useEffect(() => {
    if (!open) return;
    let current = true;
    void fetchRelayCapabilities(relayWsUrl).then((result) => {
      if (current) setCapabilities(result);
    });
    return () => {
      current = false;
    };
  }, [open, relayWsUrl]);

  useEffect(() => {
    returnFocusRef.current = returnFocusTo;
  }, [returnFocusTo]);

  useEffect(() => {
    if (!open) return;
    const returnTarget = returnFocusRef.current?.();
    titleRef.current?.focus();
    return () => {
      requestAnimationFrame(() => {
        if (returnTarget?.isConnected) returnTarget.focus();
      });
    };
  }, [open]);

  useEffect(() => {
    if (!open || editingKeyBar) return;
    // Only reached after leaving the editor; the first render keeps the title focus.
    if (leftEditor.current) {
      leftEditor.current = false;
      editKeyBarRef.current?.focus();
    }
  }, [open, editingKeyBar]);

  if (!open) return null;

  const close = () => {
    scopeChangeRef.current++;
    setCapabilities(null);
    setEditingKeyBar(false);
    setScopeSelection(null);
    setSaveStatus("");
    onClose();
  };

  const change = (next: TerminalSettings) => {
    setSaveStatus("");
    const result = onChange(next);
    setSaveStatus(
      result.ok
        ? "Saved on this device."
        : "Could not save on this device. This setting lasts until you close the page.",
    );
  };

  const selected = scopeSelection?.entryId === savedEntry?.id ? scopeSelection : null;
  const hostScope = !!savedEntry && vaultUnlocked && (selected?.host ?? !!savedEntry.terminal);
  const hostDraft = selected?.draft;
  const appearance = hostScope ? (hostDraft ?? savedEntry.terminal ?? value) : value;
  const saveAppearance = async (next: TerminalPrefs) => {
    if (!hostScope || !savedEntry || !onSaveHost) {
      change({ ...value, ...next });
      return;
    }
    const scopeChange = scopeChangeRef.current;
    setSavingHostAppearance(true);
    let saved = false;
    try {
      saved = await onSaveHost(next);
    } finally {
      setSavingHostAppearance(false);
    }
    if (saved) {
      if (scopeChange === scopeChangeRef.current) {
        setScopeSelection({ entryId: savedEntry.id, host: true, draft: next });
        setSaveStatus("Saved for this host.");
      }
    } else if (scopeChange === scopeChangeRef.current)
      setSaveStatus("Could not save settings for this host.");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      event.preventDefault();
      close();
    }
    if (event.key !== "Tab") return;
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
      'button, select, [href], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement?.id === "settings-title")
    ) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  const theme = TERMINAL_THEMES[appearance.themeName];
  const capText = (() => {
    if (value.keepAlive === "off") return "Terminals close when the connection drops.";
    if (capabilities === null) return "Checking this server's limit...";
    if (capabilities === "unknown")
      return "Could not check this server's limit. It applies when you connect.";
    if (!capabilities.resume || capabilities.maxGraceMs === 0) {
      return "This server does not keep sessions in the background. Terminals close when the connection drops.";
    }
    const cap = capabilities.maxGraceMs;
    if (cap === null) return "This server sets no limit.";
    if (value.keepAlive === "until-disconnect" || value.keepAlive * 1000 > cap) {
      return `This server limits this to ${formatGrace(cap)}. Your terminals stay open for ${formatGrace(cap)}.`;
    }
    return `This server allows up to ${formatGrace(cap)}.`;
  })();
  const dialog = editingKeyBar ? (
    <KeyBarEditor
      order={value.keyBarKeys}
      capacity={keyBarCapacity}
      onChange={(keyBarKeys) => onChange({ ...value, keyBarKeys })}
      onBack={() => {
        leftEditor.current = true;
        setEditingKeyBar(false);
      }}
      onClose={close}
    />
  ) : (
    <>
      <header className="settings-dialog__header">
        <h2 id="settings-title" ref={titleRef} tabIndex={-1}>
          Settings
        </h2>
        <button className="button" type="button" onClick={close}>
          Close
        </button>
      </header>
      <div className="settings-dialog__body">
        <h3>Terminal</h3>
        <label className="field">
          <span>Apply to</span>
          <select
            value={hostScope && vaultUnlocked && savedEntry ? "host" : "all"}
            disabled={!savedEntry || !vaultUnlocked || savingHostAppearance}
            onChange={async (event) => {
              const scopeChange = ++scopeChangeRef.current;
              if (event.target.value === "all") {
                if (savedEntry) setScopeSelection({ entryId: savedEntry.id, host: false });
                setSaveStatus("");
              } else if (savedEntry && onSaveHost) {
                if (!savedEntry.terminal) {
                  const initial = {
                    fontFamily: value.fontFamily,
                    fontSize: value.fontSize,
                    lineHeight: value.lineHeight,
                    themeName: value.themeName,
                  };
                  if (!(await onSaveHost(initial))) {
                    if (scopeChange === scopeChangeRef.current)
                      setSaveStatus("Could not save settings for this host.");
                    return;
                  }
                  if (scopeChange === scopeChangeRef.current) {
                    setScopeSelection({ entryId: savedEntry.id, host: true, draft: initial });
                    setSaveStatus("");
                  }
                } else {
                  setScopeSelection({ entryId: savedEntry.id, host: true });
                  setSaveStatus("");
                }
              }
            }}
          >
            <option value="all">All hosts</option>
            {savedEntry && <option value="host">This host: {savedEntry.nickname}</option>}
          </select>
        </label>
        {!hasSavedHost && (
          <p className="settings-dialog__hint">
            To give a host its own terminal settings, save it in Saved hosts.
          </p>
        )}
        {hasSavedHost && !vaultUnlocked && (
          <p className="settings-dialog__hint">Unlock saved hosts to use settings for this host.</p>
        )}
        {savedEntry && vaultUnlocked && hostScope && (
          <p className="settings-dialog__hint">
            {savedEntry.terminal && !hostDraft
              ? "This host uses its own terminal settings."
              : `Changes here apply only to ${savedEntry.nickname}.`}
          </p>
        )}
        <label className="field">
          <span>Font family</span>
          <select
            value={appearance.fontFamily}
            disabled={savingHostAppearance}
            onChange={(event) =>
              void saveAppearance({ ...appearance, fontFamily: event.target.value })
            }
          >
            {TERMINAL_FONTS.map((font) => (
              <option key={font.value} value={font.value}>
                {font.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Font size</span>
          <select
            value={String(appearance.fontSize)}
            disabled={savingHostAppearance}
            onChange={(event) =>
              void saveAppearance({ ...appearance, fontSize: Number(event.target.value) })
            }
          >
            {FONT_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} px
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Line height</span>
          <select
            value={appearance.lineHeight.toFixed(2)}
            disabled={savingHostAppearance}
            onChange={(event) =>
              void saveAppearance({ ...appearance, lineHeight: Number(event.target.value) })
            }
          >
            {LINE_HEIGHTS.map((height) => (
              <option key={height} value={height.toFixed(2)}>
                {height.toFixed(2)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Color scheme</span>
          <select
            value={appearance.themeName}
            disabled={savingHostAppearance}
            onChange={(event) =>
              void saveAppearance({ ...appearance, themeName: event.target.value })
            }
          >
            {Object.keys(TERMINAL_THEMES).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {savedEntry?.terminal && vaultUnlocked && (
          <button
            className="button"
            type="button"
            disabled={savingHostAppearance}
            onClick={async () => {
              if (!onSaveHost) return;
              if (await onSaveHost(null)) {
                setScopeSelection({ entryId: savedEntry.id, host: false });
                setSaveStatus("This host now uses the settings for all hosts.");
              } else setSaveStatus("Could not save settings for this host.");
            }}
          >
            Use all-hosts settings for this host
          </button>
        )}
        <pre
          className="settings-dialog__preview"
          aria-hidden="true"
          style={{
            background: theme?.background,
            color: theme?.foreground,
            fontFamily: appearance.fontFamily,
            fontSize: appearance.fontSize,
            lineHeight: appearance.lineHeight,
          }}
        >
          {activeTarget ?? "user@host"}:~$ ls{"\n"}notes scripts
        </pre>
        <h3>Session</h3>
        <label className="field">
          <span>Keep session alive in background</span>
          <select
            value={String(value.keepAlive)}
            aria-describedby={`settings-cap${hasOpenTerminals ? " settings-applies" : ""} settings-risk`}
            onChange={(event) => {
              const keepAlive = KEEP_ALIVE_CHOICES.find(
                (choice) => String(choice) === event.target.value,
              );
              if (keepAlive !== undefined) change({ ...value, keepAlive });
            }}
          >
            <option value="off">Off</option>
            <option value="120">2 min</option>
            <option value="300">5 min</option>
            <option value="600">10 min</option>
            <option value="900">15 min</option>
            <option value="3600">1 hour</option>
            <option value="until-disconnect">Until I disconnect</option>
          </select>
        </label>
        <p id="settings-cap" className="settings-dialog__hint">
          {capText}
        </p>
        {hasOpenTerminals && (
          <p id="settings-applies" className="settings-dialog__hint">
            Applies to terminals you open next. Open terminals keep the time they connected with.
          </p>
        )}
        <div id="settings-risk" className="settings-dialog__hint">
          <p>
            When you switch apps or lock your phone, the server keeps your SSH login open for this
            long so you can return to it. While it is open, anyone who can use this browser can use
            that terminal without signing in. Choose a shorter time on a shared device.
          </p>
          <p>
            If your phone closes this page, the session ends whatever you choose here. For work that
            must keep running, use tmux or screen on the server.
          </p>
        </div>
        {help && (
          <button
            className="settings-dialog__help"
            type="button"
            onClick={(event) => {
              const trigger = event.currentTarget;
              close();
              requestAnimationFrame(() => help.openHelp("background", returnFocusTo() ?? trigger));
            }}
          >
            About background sessions
          </button>
        )}
        {touchPointer && (
          <>
            <h3>Key bar</h3>
            <p className="settings-dialog__hint">
              Choose which keys show above the keyboard and in what order.
            </p>
            <button
              className="button"
              type="button"
              ref={editKeyBarRef}
              onClick={() => setEditingKeyBar(true)}
            >
              Edit key bar
            </button>
          </>
        )}
        <p className="settings-dialog__status" aria-live="polite">
          {saveStatus}
        </p>
      </div>
    </>
  );
  return createPortal(
    <div
      className="settings-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        ref={panelRef}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onKeyDown={onKeyDown}
      >
        {dialog}
      </section>
    </div>,
    document.body,
  );
}
