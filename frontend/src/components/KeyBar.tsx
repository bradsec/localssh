import { KEY_BAR_KEYS, type ModifierName, type ModifierState, type TerminalKey } from "../terminalKeys.js";

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
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <rect
        x="1.75"
        y="4.75"
        width="20.5"
        height="11.5"
        rx="2.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <g fill="currentColor">
        <rect x="4.75" y="7.5" width="2" height="2" rx="0.5" />
        <rect x="8.5" y="7.5" width="2" height="2" rx="0.5" />
        <rect x="12.25" y="7.5" width="2" height="2" rx="0.5" />
        <rect x="16" y="7.5" width="3.25" height="2" rx="0.5" />
        <rect x="4.75" y="11.25" width="2" height="2" rx="0.5" />
        <rect x="8.5" y="11.25" width="6.5" height="2" rx="0.5" />
        <rect x="16.75" y="11.25" width="2.5" height="2" rx="0.5" />
      </g>
      {dismiss && (
        <path
          d="M12 18v3.4m0 0 2.4-2.4M12 21.4 9.6 19"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
