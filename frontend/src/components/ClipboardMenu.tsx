import { useEffect, useRef, useState } from "react";
import { readClipboardText, writeClipboardText } from "../clipboard.js";

export interface ClipboardMenuProps {
  /** Whether the terminal currently holds a selection that can be copied. */
  hasSelection: boolean;
  /** The current terminal selection. */
  getSelection: () => string;
  /** Sends text to the session as a paste. */
  onPaste: (text: string) => void;
}

/**
 * A toolbar menu that gives a touch device an explicit way to copy terminal
 * text and paste into the session, neither of which a tablet browser offers
 * over an xterm surface without a hardware keyboard.
 *
 * The paste field is the reliable path: the async Clipboard API is unavailable
 * on the plain-HTTP LAN deployment, so "Paste from clipboard" is best effort and
 * pasting into the field with the on-screen callout always works.
 */
export function ClipboardMenu({ hasSelection, getSelection, onPaste }: ClipboardMenuProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const pasteFieldRef = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;

    const closeOnOutside = (event: Event) => {
      if (!detailsRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      detailsRef.current?.querySelector("summary")?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("focusin", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("focusin", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const copySelection = async () => {
    const text = getSelection();
    if (!text) {
      setStatus("Nothing is selected in the terminal.");
      return;
    }
    const ok = await writeClipboardText(text);
    setCopied(ok);
    setStatus(ok ? "Copied the selection." : "The browser blocked the copy.");
  };

  const sendPaste = (text: string) => {
    if (!text) return;
    onPaste(text);
    if (pasteFieldRef.current) pasteFieldRef.current.value = "";
    setStatus("Pasted into the session.");
    setOpen(false);
  };

  const pasteFromClipboard = async () => {
    const text = await readClipboardText();
    if (text === null) {
      setStatus("Paste into the box below instead.");
      pasteFieldRef.current?.focus();
      return;
    }
    if (!text) {
      setStatus("The clipboard is empty.");
      return;
    }
    sendPaste(text);
  };

  const indicator = copied ? "copied" : hasSelection ? "ready" : null;
  const summaryLabel = copied
    ? "Clipboard, selection copied"
    : hasSelection
      ? "Clipboard, selection ready to copy"
      : "Clipboard";

  return (
    <details
      className="clipboard-menu"
      ref={detailsRef}
      open={open}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open;
        setOpen(nextOpen);
        if (!nextOpen) {
          setStatus("");
          setCopied(false);
          if (pasteFieldRef.current) pasteFieldRef.current.value = "";
        }
      }}
    >
      <summary role="button" aria-label={summaryLabel}>
        <ClipboardMark />
        <span className="toolbar-label">Clipboard</span>
        {indicator && (
          <span
            className={`clipboard-menu__dot clipboard-menu__dot--${indicator}`}
            aria-hidden="true"
          />
        )}
      </summary>
      <div className="clipboard-menu__panel">
        <p className="clipboard-menu__hint">
          Select terminal text to copy it. Paste is sent straight to the session.
        </p>
        <button
          type="button"
          className="clipboard-menu__action"
          disabled={!hasSelection}
          onClick={copySelection}
        >
          Copy selection
        </button>
        <label className="clipboard-menu__field">
          <span>Paste here</span>
          <textarea
            ref={pasteFieldRef}
            rows={2}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            onPaste={(event) => {
              const text = event.clipboardData.getData("text");
              if (!text) return;
              event.preventDefault();
              sendPaste(text);
            }}
          />
        </label>
        <div className="clipboard-menu__row">
          <button type="button" className="clipboard-menu__action" onClick={pasteFromClipboard}>
            Paste from clipboard
          </button>
          <button
            type="button"
            className="clipboard-menu__action"
            onClick={() => sendPaste(pasteFieldRef.current?.value ?? "")}
          >
            Send box
          </button>
        </div>
        <p className="clipboard-menu__feedback" aria-live="polite">
          {status}
        </p>
      </div>
    </details>
  );
}

function ClipboardMark() {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M9 2a1 1 0 0 0-1 1v1H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V3a1 1 0 0 0-1-1H9Zm0 2h6v2H9V4Z" />
    </svg>
  );
}
