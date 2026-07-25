import { KEY_BAR_KEYS, type ModifierName, type ModifierState, type TerminalKey } from "../terminalKeys.js";

export interface KeyBarProps {
  modifiers: ModifierState;
  onToggleModifier: (name: ModifierName) => void;
  onKey: (key: TerminalKey) => void;
}

const MODIFIERS: { name: ModifierName; label: string }[] = [
  { name: "ctrl", label: "ctrl" },
  { name: "alt", label: "alt" },
];

/**
 * The row of terminal keys that sits above a phone's on-screen keyboard.
 *
 * Every button suppresses the default action of the pointer press that starts
 * it. That press would otherwise move focus off the terminal, and the keyboard
 * this bar exists to sit above would close under it.
 */
export function KeyBar({ modifiers, onToggleModifier, onKey }: KeyBarProps) {
  const keepTerminalFocused = (event: { preventDefault: () => void }) => event.preventDefault();

  return (
    <div className="key-bar" role="toolbar" aria-label="Terminal keys">
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
