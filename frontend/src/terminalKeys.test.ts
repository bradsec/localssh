import { describe, expect, it } from "vitest";
import {
  applyModifiers,
  controlCode,
  cycleModifier,
  keySequence,
  KEY_BAR_KEYS,
  NO_MODIFIERS,
  spendModifiers,
  type ModifierState,
} from "./terminalKeys.js";

describe("cycleModifier", () => {
  it("goes off, armed for one key, locked, and back off", () => {
    expect(cycleModifier("off")).toBe("once");
    expect(cycleModifier("once")).toBe("locked");
    expect(cycleModifier("locked")).toBe("off");
  });
});

describe("controlCode", () => {
  it("maps letters to their control code in either case", () => {
    expect(controlCode("c")).toBe("\x03");
    expect(controlCode("C")).toBe("\x03");
    expect(controlCode("a")).toBe("\x01");
    expect(controlCode("z")).toBe("\x1a");
  });

  it("maps the punctuation that carries a control code", () => {
    expect(controlCode("[")).toBe("\x1b");
    expect(controlCode("\\")).toBe("\x1c");
    expect(controlCode("?")).toBe("\x7f");
    expect(controlCode(" ")).toBe("\x00");
  });

  it("reports characters with no control code", () => {
    expect(controlCode("1")).toBeNull();
    expect(controlCode("é")).toBeNull();
    expect(controlCode("ab")).toBeNull();
  });
});

describe("keySequence", () => {
  it("sends a key's literal bytes", () => {
    const escape = KEY_BAR_KEYS.find((key) => key.id === "esc");
    expect(escape && keySequence(escape, false)).toBe("\x1b");
  });

  // Full-screen programs such as vim and less switch cursor keys to the
  // application encoding, and the other one is ignored or echoed as text.
  it("encodes cursor keys for the terminal's current mode", () => {
    const up = KEY_BAR_KEYS.find((key) => key.id === "up");
    if (!up) throw new Error("expected an up key");

    expect(keySequence(up, false)).toBe("\x1b[A");
    expect(keySequence(up, true)).toBe("\x1bOA");
  });

  it("gives every key on the bar something to send", () => {
    for (const key of KEY_BAR_KEYS) {
      expect(keySequence(key, false)).not.toBe("");
    }
  });
});

describe("applyModifiers", () => {
  const armed = (state: Partial<ModifierState>): ModifierState => ({ ...NO_MODIFIERS, ...state });

  it("passes input through untouched when nothing is armed", () => {
    expect(applyModifiers("c", NO_MODIFIERS)).toEqual({ data: "c", next: NO_MODIFIERS });
  });

  it("turns the next character into a control code", () => {
    const result = applyModifiers("r", armed({ ctrl: "once" }));

    expect(result.data).toBe("\x12");
    expect(result.next).toEqual(NO_MODIFIERS);
  });

  it("prefixes Alt input with Escape, which is how Meta is carried", () => {
    expect(applyModifiers("b", armed({ alt: "once" })).data).toBe("\x1bb");
    expect(applyModifiers("\x1b[C", armed({ alt: "once" })).data).toBe("\x1b\x1b[C");
  });

  it("combines Ctrl and Alt", () => {
    expect(applyModifiers("c", armed({ ctrl: "once", alt: "once" })).data).toBe("\x1b\x03");
  });

  it("keeps a locked modifier armed", () => {
    const state = armed({ ctrl: "locked" });
    const first = applyModifiers("a", state);
    const second = applyModifiers("b", first.next);

    expect(first.data).toBe("\x01");
    expect(second.data).toBe("\x02");
    expect(second.next).toEqual(state);
  });

  // A pasted string or a bar key's escape sequence has no single character for
  // Ctrl to act on, so it must arrive as typed rather than mangled.
  it("leaves multi-character input alone for Ctrl", () => {
    const result = applyModifiers("ls -l", armed({ ctrl: "once" }));

    expect(result.data).toBe("ls -l");
    expect(result.next).toEqual(NO_MODIFIERS);
  });

  it("leaves a character with no control code alone", () => {
    expect(applyModifiers("1", armed({ ctrl: "once" })).data).toBe("1");
  });

  it("ignores empty input rather than spending a modifier on it", () => {
    const state = armed({ ctrl: "once" });
    expect(applyModifiers("", state)).toEqual({ data: "", next: state });
  });
});

describe("spendModifiers", () => {
  it("returns the same state when nothing is armed for one key", () => {
    const state: ModifierState = { ctrl: "locked", alt: "off" };
    expect(spendModifiers(state)).toBe(state);
  });

  it("clears only the modifiers armed for one key", () => {
    expect(spendModifiers({ ctrl: "once", alt: "locked" })).toEqual({
      ctrl: "off",
      alt: "locked",
    });
  });
});
