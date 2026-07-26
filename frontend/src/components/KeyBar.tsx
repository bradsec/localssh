import {
  KEY_BAR_KEYS,
  type ModifierName,
  type ModifierState,
  type TerminalKey,
} from "../terminalKeys.js";
import { Icon } from "./Icon.js";

export interface KeyBarProps {
  modifiers: ModifierState;
  /** Whether the terminal holds focus, which on a phone means the keyboard is up. */
  keyboardUp: boolean;
  onToggleKeyboard: () => void;
  onToggleModifier: (name: ModifierName) => void;
  onKey: (key: TerminalKey) => void;
}

const MODIFIERS: { name: ModifierName; label: string }[] = [
  { name: "ctrl", label: "ctrl" },
  { name: "alt", label: "alt" },
];

/**
 * The row of terminal keys that sits along the bottom of a touch session.
 *
 * Every button suppresses the default action of the pointer press that starts
 * it. That press would otherwise move focus off the terminal, and the on-screen
 * keyboard would close under whichever key was aimed at.
 */
export function KeyBar({
  modifiers,
  keyboardUp,
  onToggleKeyboard,
  onToggleModifier,
  onKey,
}: KeyBarProps) {
  const keepTerminalFocused = (event: { preventDefault: () => void }) => event.preventDefault();

  return (
    <div className="key-bar" role="toolbar" aria-label="Terminal keys">
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
      {MODIFIERS.map(({ name, label }) => (
        <button
          key={name}
          className={`key-bar__key key-bar__key--modifier key-bar__key--${modifiers[name]}`}
          type="button"
          aria-pressed={modifiers[name] !== "off"}
          onPointerDown={keepTerminalFocused}
          onMouseDown={keepTerminalFocused}
          onClick={() => onToggleModifier(name)}
        >
          {label}
        </button>
      ))}
      {KEY_BAR_KEYS.map((key) => (
        <button
          key={key.id}
          // A one-character face is an arrow or a punctuation mark, and both are
          // drawn too small to aim at when set at the size of a word like "tab".
          className={key.label.length === 1 ? "key-bar__key key-bar__key--glyph" : "key-bar__key"}
          type="button"
          aria-label={key.ariaLabel ?? key.label}
          onPointerDown={keepTerminalFocused}
          onMouseDown={keepTerminalFocused}
          onClick={() => onKey(key)}
        >
          <span aria-hidden="true">{key.label}</span>
        </button>
      ))}
    </div>
  );
}

/** A keyboard, gaining an arrow down out of it when tapping would dismiss it. */
function KeyboardMark({ dismiss }: { dismiss: boolean }) {
  return (
    <>
      <Icon name="keyboard" />
      {dismiss && (
        <svg
          className="key-bar__keyboard-dismiss-cue"
          viewBox="0 -960 960 960"
          width="20"
          height="20"
          aria-hidden="true"
          focusable="false"
          data-testid="keyboard-dismiss-cue"
        >
          <path
            d="M480-240v136m0 0 96-96m-96 96-96-96"
            fill="none"
            stroke="currentColor"
            strokeWidth="64"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </>
  );
}
