// The keys a phone keyboard does not have.
//
// A shell needs Esc, Tab, Ctrl and the cursor keys, and an on-screen keyboard
// offers none of them. The bar above the keyboard supplies them, and Ctrl and
// Alt work as sticky modifiers so a letter typed on the system keyboard can be
// turned into a control code on its way to the terminal.

export type ModifierName = "ctrl" | "alt";

/**
 * `once` applies to the next key and then clears, `locked` stays until it is
 * tapped off. One tap arms, a second locks, a third clears.
 */
export type ModifierMode = "off" | "once" | "locked";

export type ModifierState = Record<ModifierName, ModifierMode>;

export const NO_MODIFIERS: ModifierState = { ctrl: "off", alt: "off" };

/** A cursor key, whose bytes depend on the terminal's application cursor mode. */
export type CursorKey = "up" | "down" | "left" | "right" | "home" | "end";

export interface TerminalKey {
  id: string;
  /** Face of the key. */
  label: string;
  /** Spoken name, where the label alone does not read well. */
  ariaLabel?: string;
  /** Literal bytes to send. */
  sequence?: string;
  /** Cursor key to send instead, resolved against the terminal's mode. */
  cursor?: CursorKey;
}

/**
 * The bar's keys, in order. History recall leads: cursor up and Enter are all it
 * takes to run a previous command, and with those on the bar that can be done
 * without the on-screen keyboard open at all. Esc, Tab and the Ctrl shortcuts
 * that interrupt, end input and suspend a job follow, and the punctuation at the
 * end is buried behind a shift on the iOS keyboard but common in a command line.
 */
export const KEY_BAR_KEYS: readonly TerminalKey[] = [
  { id: "up", label: "↑", ariaLabel: "Up arrow", cursor: "up" },
  { id: "down", label: "↓", ariaLabel: "Down arrow", cursor: "down" },
  { id: "enter", label: "⏎", ariaLabel: "Enter", sequence: "\r" },
  // DEL rather than BS: it is what a terminal's erase character is set to
  // almost everywhere, and what the Backspace key on a desktop sends.
  { id: "backspace", label: "⌫", ariaLabel: "Backspace", sequence: "\x7f" },
  { id: "esc", label: "esc", ariaLabel: "Escape", sequence: "\x1b" },
  { id: "tab", label: "tab", ariaLabel: "Tab", sequence: "\t" },
  { id: "ctrl-c", label: "^C", ariaLabel: "Control C, interrupt", sequence: "\x03" },
  { id: "left", label: "←", ariaLabel: "Left arrow", cursor: "left" },
  { id: "right", label: "→", ariaLabel: "Right arrow", cursor: "right" },
  { id: "ctrl-d", label: "^D", ariaLabel: "Control D, end of input", sequence: "\x04" },
  { id: "ctrl-z", label: "^Z", ariaLabel: "Control Z, suspend", sequence: "\x1a" },
  { id: "home", label: "home", ariaLabel: "Home", cursor: "home" },
  { id: "end", label: "end", ariaLabel: "End", cursor: "end" },
  { id: "pipe", label: "|", ariaLabel: "Pipe", sequence: "|" },
  { id: "slash", label: "/", ariaLabel: "Slash", sequence: "/" },
  { id: "tilde", label: "~", ariaLabel: "Tilde", sequence: "~" },
  { id: "dash", label: "-", ariaLabel: "Hyphen", sequence: "-" },
];

/** Advances a modifier one step through off, armed for one key, and locked. */
export function cycleModifier(mode: ModifierMode): ModifierMode {
  switch (mode) {
    case "off":
      return "once";
    case "once":
      return "locked";
    case "locked":
      return "off";
  }
}

/** Bytes for a key press, given the terminal's current cursor key encoding. */
export function keySequence(key: TerminalKey, applicationCursorKeys: boolean): string {
  if (key.cursor) return cursorSequence(key.cursor, applicationCursorKeys);
  return key.sequence ?? "";
}

function cursorSequence(cursor: CursorKey, applicationCursorKeys: boolean): string {
  const introducer = applicationCursorKeys ? "\x1bO" : "\x1b[";
  switch (cursor) {
    case "up":
      return `${introducer}A`;
    case "down":
      return `${introducer}B`;
    case "right":
      return `${introducer}C`;
    case "left":
      return `${introducer}D`;
    case "home":
      return `${introducer}H`;
    case "end":
      return `${introducer}F`;
  }
}

/**
 * The control code a character carries, or null where it has none. Letters map
 * to 1-26 by their position in the alphabet, and the handful of punctuation
 * codes below them complete the range a terminal can receive.
 */
export function controlCode(character: string): string | null {
  if (character.length !== 1) return null;

  const upper = character.toUpperCase();
  if (upper >= "A" && upper <= "Z") {
    return String.fromCharCode(upper.charCodeAt(0) - 64);
  }

  switch (character) {
    case "@":
    case " ":
      return "\x00";
    case "[":
      return "\x1b";
    case "\\":
      return "\x1c";
    case "]":
      return "\x1d";
    case "^":
      return "\x1e";
    case "_":
      return "\x1f";
    case "?":
      return "\x7f";
    default:
      return null;
  }
}

/**
 * Applies the armed modifiers to input on its way to the terminal and reports
 * the state they are left in: `once` modifiers are spent by any input, and a
 * `locked` one stays armed.
 *
 * Ctrl only has meaning for a single character. Longer input is a bar key's
 * escape sequence or pasted text, which passes through unchanged; Alt still
 * prefixes it with Esc, which is how a terminal carries a Meta press and what
 * makes Alt plus a cursor key move by words.
 */
export function applyModifiers(
  data: string,
  state: ModifierState,
): { data: string; next: ModifierState } {
  if (data === "") return { data, next: state };

  let sent = data;
  if (state.ctrl !== "off") sent = controlCode(sent) ?? sent;
  if (state.alt !== "off") sent = `\x1b${sent}`;

  return { data: sent, next: spendModifiers(state) };
}

/** Clears the modifiers armed for a single key, keeping the locked ones. */
export function spendModifiers(state: ModifierState): ModifierState {
  if (state.ctrl !== "once" && state.alt !== "once") return state;
  return {
    ctrl: state.ctrl === "once" ? "off" : state.ctrl,
    alt: state.alt === "once" ? "off" : state.alt,
  };
}
