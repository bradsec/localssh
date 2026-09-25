import { describe, expect, it } from "vitest";
import { resizeKeepingSelection, type SelectableTerminal } from "./terminalSelection.js";

interface Range {
  column: number;
  row: number;
  length: number;
}

/** A terminal that reads a fixed buffer and, like xterm, can drop its selection on resize. */
function fakeTerminal(lines: string[], cols: number) {
  let selection: Range | null = null;
  const text = lines.map((line) => line.padEnd(cols)).join("");
  const term: SelectableTerminal & { cols: number } = {
    cols,
    hasSelection: () => selection !== null,
    getSelection: () => {
      if (!selection) return "";
      const offset = selection.row * term.cols + selection.column;
      return text.slice(offset, offset + selection.length);
    },
    getSelectionPosition: () => {
      if (!selection) return undefined;
      const end = selection.row * term.cols + selection.column + selection.length;
      return {
        start: { x: selection.column, y: selection.row },
        end: { x: end % term.cols, y: Math.floor(end / term.cols) },
      };
    },
    select: (column, row, length) => {
      selection = { column, row, length };
    },
    clearSelection: () => {
      selection = null;
    },
  };
  return term;
}

describe("resizeKeepingSelection", () => {
  it("restores a selection that a row-only resize cleared", () => {
    const term = fakeTerminal(["alpha beta", "gamma delta"], 12);
    term.select(6, 0, 11);
    const before = term.getSelection();

    resizeKeepingSelection(term, () => term.clearSelection());

    expect(term.hasSelection()).toBe(true);
    expect(term.getSelection()).toBe(before);
  });

  it("leaves a selection alone when the resize kept it", () => {
    const term = fakeTerminal(["alpha"], 8);
    term.select(0, 0, 3);
    let selects = 0;
    const select = term.select;
    term.select = (...args) => {
      selects += 1;
      select(...args);
    };

    resizeKeepingSelection(term, () => {});

    expect(selects).toBe(0);
    expect(term.getSelection()).toBe("alp");
  });

  it("does not restore when the column count changed", () => {
    const term = fakeTerminal(["alpha beta"], 12);
    term.select(0, 0, 5);

    resizeKeepingSelection(term, () => {
      term.clearSelection();
      term.cols = 10;
    });

    expect(term.hasSelection()).toBe(false);
  });

  it("clears a restored selection that no longer covers the same text", () => {
    const term = fakeTerminal(["alpha", "beta"], 8);
    term.select(0, 1, 4);
    const getSelection = term.getSelection;
    let resized = false;
    term.getSelection = () => (resized ? "shifted" : getSelection());

    resizeKeepingSelection(term, () => {
      term.clearSelection();
      resized = true;
    });

    expect(term.hasSelection()).toBe(false);
  });

  it("only resizes when there is no selection", () => {
    const term = fakeTerminal(["alpha"], 8);
    let resized = 0;

    resizeKeepingSelection(term, () => {
      resized += 1;
    });

    expect(resized).toBe(1);
    expect(term.hasSelection()).toBe(false);
  });
});
