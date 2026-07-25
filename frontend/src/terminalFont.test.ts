import { describe, expect, it } from "vitest";
import { applyFontOptions, remeasureFamilyFor } from "./terminalFont.js";

/** Records every family written, which is what forces a re-measure. */
function fakeTerminal(fontSize: number, fontFamily: string) {
  const familyWrites: string[] = [];
  const state = { fontSize, fontFamily };
  const terminal = {
    options: {
      get fontSize() {
        return state.fontSize;
      },
      set fontSize(next: number) {
        state.fontSize = next;
      },
      get fontFamily() {
        return state.fontFamily;
      },
      set fontFamily(next: string) {
        state.fontFamily = next;
        familyWrites.push(next);
      },
    },
  };

  return { terminal, familyWrites, state };
}

describe("applyFontOptions", () => {
  it("sets the size and leaves the wanted family in place", () => {
    const { terminal, state } = fakeTerminal(14, '"Fira Code", monospace');

    applyFontOptions(terminal, 22, '"Fira Code", monospace');

    expect(state.fontSize).toBe(22);
    expect(state.fontFamily).toBe('"Fira Code", monospace');
  });

  // The re-measure only happens on a family that differs from the current one,
  // so the family has to be written away and back, not just written again.
  it("bounces the family off another one so the terminal measures again", () => {
    const { terminal, familyWrites } = fakeTerminal(14, '"Fira Code", monospace');

    applyFontOptions(terminal, 22, '"Fira Code", monospace');

    expect(familyWrites).toEqual(["monospace", '"Fira Code", monospace']);
  });

  // "System Monospace" is the literal string "monospace", and bouncing it off
  // itself would change nothing and measure nothing.
  it("picks a different intermediate family when the wanted one is monospace", () => {
    const { terminal, familyWrites, state } = fakeTerminal(14, "monospace");

    applyFontOptions(terminal, 22, "monospace");

    expect(familyWrites).toEqual(["sans-serif", "monospace"]);
    expect(state.fontFamily).toBe("monospace");
  });

  it("never offers an intermediate family equal to the wanted one", () => {
    for (const family of [
      "monospace",
      "sans-serif",
      '"Fira Code", monospace',
      '"JetBrains Mono", monospace',
    ]) {
      expect(remeasureFamilyFor(family)).not.toBe(family);
    }
  });
});
