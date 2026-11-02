import { type ModifierName, type ModifierState, type TerminalKey } from "../terminalKeys.js";
import { FONT_SIZE_MAX, FONT_SIZE_MIN } from "../storage/settingsStore.js";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Keyboard } from "lucide-react";

/** Width of a key and the gap between keys, in px. Must match .key-bar__key in app.css. */
const KEY_WIDTH = 44;
const KEY_GAP = 4;

export interface KeyBarProps {
  disabled?: boolean;
  /** The keys to show, in order. */
  keys: readonly TerminalKey[];
  /** Current terminal text size, for disabling the size keys at their limits. */
  fontSize: number;
  modifiers: ModifierState;
  /** Whether the terminal holds focus, which on a phone means the keyboard is up. */
  keyboardUp: boolean;
  onToggleKeyboard: () => void;
  onToggleModifier: (name: ModifierName) => void;
  onKey: (key: TerminalKey) => void;
  /** Called with how many keys fit in the row, whenever that changes. */
  onCapacityChange?: (n: number) => void;
  /** Whether the More keys panel is open. The page owns it so it can close it. */
  morePanelOpen: boolean;
  onMorePanelOpenChange: (open: boolean) => void;
}

/**
 * The row of terminal keys that sits along the bottom of a touch session.
 *
 * Every button suppresses the default action of the pointer press that starts
 * it. That press would otherwise move focus off the terminal, and the on-screen
 * keyboard would close under whichever key was aimed at.
 */
export function KeyBar({
  disabled = false,
  keys,
  fontSize,
  modifiers,
  keyboardUp,
  onToggleKeyboard,
  onToggleModifier,
  onKey,
  onCapacityChange,
  morePanelOpen,
  onMorePanelOpenChange,
}: KeyBarProps) {
  const keepTerminalFocused = (event: { preventDefault: () => void }) => event.preventDefault();
  const rowRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  // Until the row has been measured every key is shown, which is also what a
  // browser without ResizeObserver gets.
  const [capacity, setCapacity] = useState(Number.POSITIVE_INFINITY);
  const open = morePanelOpen && !disabled;

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const width = row.clientWidth;
      if (width <= 0) return;
      const fits = Math.max(0, Math.floor((width + KEY_GAP) / (KEY_WIDTH + KEY_GAP)));
      setCapacity(fits);
      onCapacityChange?.(fits);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [onCapacityChange]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onMorePanelOpenChange(false);
      moreRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onMorePanelOpenChange]);

  const rowKeys = keys.slice(0, capacity);
  const panelKeys = keys.slice(capacity);

  const renderKey = (key: TerminalKey) => {
    const { modifier, action } = key;
    const atLimit =
      (action === "text-smaller" && fontSize <= FONT_SIZE_MIN) ||
      (action === "text-larger" && fontSize >= FONT_SIZE_MAX);
    const inactive = disabled || atLimit;
    const press = () => {
      if (inactive) return;
      if (modifier) onToggleModifier(modifier);
      else onKey(key);
    };
    const classes = ["key-bar__key"];
    if (modifier) classes.push("key-bar__key--modifier", `key-bar__key--${modifiers[modifier]}`);
    // A one-character face is an arrow or a punctuation mark, and both are
    // drawn too small to aim at when set at the size of a word like "tab".
    else if (key.label.length === 1) classes.push("key-bar__key--glyph");
    return (
      <button
        key={key.id}
        className={classes.join(" ")}
        type="button"
        aria-label={key.ariaLabel}
        aria-pressed={modifier ? modifiers[modifier] !== "off" : undefined}
        aria-disabled={inactive}
        onPointerDown={keepTerminalFocused}
        onMouseDown={keepTerminalFocused}
        onPointerUp={press}
        onClick={(event) => {
          if (event.detail === 0) press();
        }}
      >
        {modifier ? key.label : <span aria-hidden="true">{key.label}</span>}
      </button>
    );
  };

  const toggleMore = () => {
    if (!disabled) onMorePanelOpenChange(!open);
  };

  return (
    <>
      <div
        className={open ? "key-bar key-bar--panel-open" : "key-bar"}
        role="toolbar"
        aria-label="Terminal keys"
      >
        {!disabled && (
          <button
            className="key-bar__key key-bar__key--keyboard"
            type="button"
            aria-label={keyboardUp ? "Hide keyboard" : "Show keyboard"}
            aria-pressed={keyboardUp}
            onPointerDown={keepTerminalFocused}
            onMouseDown={keepTerminalFocused}
            // Raising the keyboard means focusing the terminal, and Safari opens it
            // only for a focus made during the gesture that asked for it, so this
            // acts on the release rather than waiting for the click that follows.
            onPointerUp={onToggleKeyboard}
            // Which leaves the click for the ways of pressing a button that send no
            // pointer events at all, such as Enter on a hardware keyboard.
            onClick={(event) => {
              if (event.detail === 0) onToggleKeyboard();
            }}
          >
            <KeyboardMark dismiss={keyboardUp} />
          </button>
        )}
        <div className="key-bar__keys" ref={rowRef} data-testid="key-bar-row">
          {rowKeys.map(renderKey)}
        </div>
        <button
          ref={moreRef}
          className="key-bar__key key-bar__key--more"
          type="button"
          aria-label="More keys"
          aria-expanded={open}
          aria-controls={panelId}
          aria-disabled={disabled}
          onPointerDown={keepTerminalFocused}
          onMouseDown={keepTerminalFocused}
          onPointerUp={toggleMore}
          onClick={(event) => {
            if (event.detail === 0) toggleMore();
          }}
        >
          <span aria-hidden="true">More</span>
          {open ? (
            <ChevronDown aria-hidden="true" size={14} />
          ) : (
            <ChevronUp aria-hidden="true" size={14} />
          )}
        </button>
      </div>
      {open && (
        <div className="key-bar-panel" id={panelId} role="group" aria-label="More keys">
          {panelKeys.length > 0 ? (
            panelKeys.map(renderKey)
          ) : (
            <p className="key-bar-panel__empty">
              {keys.length === 0
                ? "No keys. Add keys in Settings, Key bar."
                : "All keys are in the row."}
            </p>
          )}
        </div>
      )}
    </>
  );
}

/** A keyboard, gaining a chevron down under it when tapping would dismiss it. */
function KeyboardMark({ dismiss }: { dismiss: boolean }) {
  return (
    <>
      <Keyboard />
      {dismiss && (
        <ChevronDown
          className="key-bar__keyboard-dismiss-cue"
          size={14}
          data-testid="keyboard-dismiss-cue"
        />
      )}
    </>
  );
}
