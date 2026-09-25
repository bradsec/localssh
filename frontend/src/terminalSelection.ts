import type { Terminal } from "@xterm/xterm";

export type SelectableTerminal = Pick<
  Terminal,
  "cols" | "hasSelection" | "getSelection" | "getSelectionPosition" | "select" | "clearSelection"
>;

/**
 * Runs a terminal resize without losing the user's selection.
 *
 * xterm clears the selection whenever the row count changes (xterm.js #5300).
 * On a phone or tablet the row count changes each time the on-screen keyboard
 * opens or closes, and reaching the Copy button moves focus off the terminal,
 * which closes the keyboard. Without this, a touch selection is gone before it
 * can be copied.
 *
 * The selection is put back only when the column count is unchanged, so buffer
 * coordinates still address the same cells, and only while it still covers the
 * same text.
 */
export function resizeKeepingSelection(term: SelectableTerminal, resize: () => void): void {
  const position = term.getSelectionPosition();
  if (!position) {
    resize();
    return;
  }
  const text = term.getSelection();
  const cols = term.cols;

  resize();

  if (term.hasSelection() || term.cols !== cols) return;
  const { start, end } = position;
  // The end position is exclusive, so the difference in offsets is the length.
  term.select(start.x, start.y, (end.y - start.y) * cols + end.x - start.x);
  if (term.getSelection() !== text) term.clearSelection();
}
