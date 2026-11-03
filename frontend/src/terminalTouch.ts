import type { IMarker, Terminal } from "@xterm/xterm";
import { cursorSequence } from "./terminalKeys.js";

/** A cell in the active buffer: absolute buffer row and cell column. */
export interface BufferPoint {
  row: number;
  col: number;
}

function before(a: BufferPoint, b: BufferPoint): boolean {
  return a.row < b.row || (a.row === b.row && a.col < b.col);
}

/**
 * Whether a cell holds a character the shell's line editor knows about. Cells
 * never written (or erased) report no characters, and the second cell of a wide
 * character has width 0, so neither counts. A typed space is written as " ".
 */
function isCharacter(term: Terminal, row: number, col: number): boolean {
  const cell = term.buffer.active.getLine(row)?.getCell(col);
  return !!cell && cell.getWidth() > 0 && cell.getChars() !== "";
}

/** Records only text sent to the session; null stays unusable until a reset. */
export function recordTypedText(current: string | null, data: string): string | null {
  if (current === null) return null;
  // oxlint-disable-next-line no-control-regex -- bracketed paste markers contain ESC.
  const paste = /^\x1b\[200~([\s\S]*)\x1b\[201~$/.exec(data);
  if (paste) data = paste[1]!;
  else if (data.includes("\x1b")) return null;
  for (const char of data) {
    if (char === "\x7f") current = Array.from(current).slice(0, -1).join("");
    // oxlint-disable-next-line no-control-regex -- controls cannot be recorded as text.
    else if (/[\x00-\x1f\x80-\x9f]/.test(char)) return null;
    else current += char;
  }
  return current;
}

/** Maps each recorded character boundary to an autowrapped screen position. */
function recordedPositions(term: Terminal, start: BufferPoint, text: string): BufferPoint[] | null {
  const buffer = term.buffer.active;
  let { row, col } = start;
  const positions = [start];
  for (const char of text) {
    if (col >= term.cols) {
      if (!buffer.getLine(row + 1)?.isWrapped) return null;
      row++;
      col = 0;
    }
    const line = buffer.getLine(row);
    const cell = line?.getCell(col);
    if (
      !cell ||
      !isCharacter(term, row, col) ||
      line?.translateToString(false, col, col + cell.getWidth()) !== char
    )
      return null;
    col += cell.getWidth();
    positions.push({ row, col });
  }
  return positions;
}

/**
 * Bytes that replay a native edit of the selected range through the shell's line
 * editor: cursor keys to the range's end, then one DEL per selected character.
 *
 * It acts only when the screen agrees with text sent on this command line.
 * The selected range and cursor must both lie inside that recorded span.
 */
export function selectionEditBytes(
  term: Terminal,
  inputStart: BufferPoint | null,
  start: BufferPoint,
  end: BufferPoint,
  applicationCursorMode: boolean,
  recordedText: string | null = null,
): string | null {
  const buffer = term.buffer.active;
  if (buffer.type === "alternate") return null;
  const cursor = { row: buffer.baseY + buffer.cursorY, col: buffer.cursorX };
  if (
    !inputStart ||
    recordedText === null ||
    before(cursor, inputStart) ||
    before(start, inputStart)
  )
    return null;
  const positions = recordedPositions(term, inputStart, recordedText);
  if (!positions) return null;
  const indexOf = (point: BufferPoint) =>
    positions.findIndex(
      (position) =>
        (position.row === point.row && position.col === point.col) ||
        (position.col === term.cols &&
          position.row + 1 === point.row &&
          point.col === 0 &&
          buffer.getLine(point.row)?.isWrapped),
    );
  const selectionStart = indexOf(start);
  const selectionEnd = indexOf(end);
  const cursorIndex = indexOf(cursor);
  if (selectionStart < 0 || selectionEnd < 0 || cursorIndex < 0) return null;
  const deletions = selectionEnd - selectionStart;
  if (deletions <= 0) return null;
  const cursorAfter = cursorIndex >= selectionEnd;
  const moves = Math.abs(cursorIndex - selectionEnd);
  const arrow = cursorSequence(cursorAfter ? "left" : "right", applicationCursorMode);
  return arrow.repeat(moves) + "\x7f".repeat(deletions);
}

/**
 * Maps a DOM range inside the mirrored `rows` to buffer cells. `top` is the
 * buffer line the first mirrored row showed when the rows were last synced,
 * which differs from the live viewport while the copy is frozen. Returns null
 * when any row the range touches no longer shows its live line's text, because
 * text offsets in a stale row land on different cells.
 */
export function bufferRange(
  term: Terminal,
  rows: Element,
  top: number,
  range: AbstractRange,
): { start: BufferPoint; end: BufferPoint } | null {
  if (range.collapsed) return null;
  const pointAt = (node: Node, offset: number): BufferPoint | null => {
    const index = Array.from(rows.children).findIndex((row) => row.contains(node));
    const element = rows.children[index];
    const bufferRow = top + index;
    const line = term.buffer.active.getLine(bufferRow);
    if (index < 0 || !element || !line) return null;
    const prefix = document.createRange();
    prefix.selectNodeContents(element);
    prefix.setEnd(node, offset);
    const textOffset = prefix.toString().length;
    let textLength = 0;
    for (let col = 0; col < term.cols; col++) {
      const cell = line.getCell(col);
      if (!cell || cell.getWidth() === 0) continue;
      if (textLength >= textOffset) return { row: bufferRow, col };
      textLength += (cell.getChars() || " ").length;
      if (textLength >= textOffset) return { row: bufferRow, col: col + cell.getWidth() };
    }
    return { row: bufferRow, col: term.cols };
  };
  const start = pointAt(range.startContainer, range.startOffset);
  const end = pointAt(range.endContainer, range.endOffset);
  if (!start || !end || !before(start, end)) return null;
  for (let row = start.row; row <= end.row; row++) {
    const frozen = (rows.children[row - top]?.textContent ?? "").replace(/\xa0/g, " ").trimEnd();
    const live = term.buffer.active.getLine(row)?.translateToString(true).trimEnd();
    if (frozen !== live) return null;
  }
  return { start, end };
}

/**
 * Brings `mirror` to the same rows as `source`, touching only the rows that
 * differ. A native text selection collapses when its nodes are replaced, so a
 * row that did not change must keep its element.
 */
export function syncVisibleRows(source: Element, mirror: Element): void {
  const rows = source.children;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!;
    const current = mirror.children[index];
    if (!current) mirror.append(row.cloneNode(true));
    else if (!current.isEqualNode(row)) current.replaceWith(row.cloneNode(true));
  }
  while (mirror.children.length > rows.length) mirror.lastElementChild?.remove();
}

/** Whether the page selection is a non-empty range that starts inside `root`. */
export function hasSelectionIn(root: Node): boolean {
  const selection = document.getSelection();
  return (
    !!selection &&
    !selection.isCollapsed &&
    !!selection.anchorNode &&
    root.contains(selection.anchorNode)
  );
}

export interface TouchTextLayer {
  /** The editing host: focus, keyboard, native selection, and paste. */
  mirror: HTMLElement;
  /** The copy of the visible rows inside the host, one child per terminal row. */
  rows: HTMLElement;
  hasSelection: () => boolean;
  /**
   * The buffer line the first mirrored row shows, tracked through scrollback
   * trimming while the copy is frozen; null when that line is gone.
   */
  rowsTop: () => number | null;
  /** Collapses a selection in the host to a caret at the xterm cursor and resyncs. */
  releaseSelection: () => void;
  dispose: () => void;
}

/**
 * Lays a transparent, editable copy of the visible rows over the terminal so a
 * touch device can use its own text selection, Copy, and Paste on the live
 * terminal. The copy takes the terminal's font options, and each cloned row
 * brings xterm's inline width and height, so the cells line up. It is rebuilt
 * after every render and scroll. While a selection or an IME composition exists
 * the copy stops updating, because replacing a row would drop the selection
 * under the user's finger or the text being composed.
 */
export function attachTouchTextLayer(term: Terminal): TouchTextLayer | null {
  const screen = term.element?.querySelector(".xterm-screen");
  const source = screen?.querySelector(".xterm-rows");
  if (!screen || !source) return null;

  const mirror = document.createElement("div");
  mirror.className = "terminal-touch-text";
  mirror.setAttribute("contenteditable", "plaintext-only");
  mirror.setAttribute("inputmode", "none");
  mirror.setAttribute("autocorrect", "off");
  mirror.setAttribute("autocapitalize", "off");
  mirror.setAttribute("spellcheck", "false");
  mirror.setAttribute("enterkeyhint", "enter");
  mirror.setAttribute("role", "textbox");
  mirror.setAttribute("aria-multiline", "true");
  mirror.setAttribute("aria-label", "Terminal input and text selection");
  // The host stays a named, focusable field, but its copy of the rows is hidden
  // from screen readers: xterm's accessibility tree already announces the output.
  const rows = document.createElement("div");
  rows.className = "terminal-touch-rows";
  rows.setAttribute("aria-hidden", "true");
  mirror.append(rows);
  screen.append(mirror);

  // The live rows take their font from xterm's injected stylesheet and their
  // letter spacing from the renderer, so the copy reads the computed values.
  const applyFont = () => {
    const live = getComputedStyle(source);
    mirror.style.fontFamily = live.fontFamily;
    mirror.style.fontSize = live.fontSize;
    mirror.style.fontWeight = live.fontWeight;
    mirror.style.letterSpacing = live.letterSpacing;
    mirror.style.lineHeight = live.lineHeight;
  };

  let stale = false;
  let composing = false;
  // A marker moves with its line when scrollback is trimmed and is disposed
  // when the line itself goes, so a frozen copy still maps to the right lines.
  let top: IMarker | undefined;
  const markTop = () => {
    const buffer = term.buffer.active;
    if (top && !top.isDisposed && top.line === buffer.viewportY) return;
    top?.dispose();
    top = term.registerMarker(buffer.viewportY - buffer.baseY - buffer.cursorY);
  };
  const placeCaretAtCursor = () => {
    const row = rows.children[term.buffer.active.cursorY];
    const selection = document.getSelection();
    if (!row || !selection || !selection.isCollapsed) return;
    const range = document.createRange();
    let remaining = Math.min(term.buffer.active.cursorX, row.textContent?.length ?? 0);
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && remaining > (node.textContent?.length ?? 0)) {
      remaining -= node.textContent?.length ?? 0;
      node = walker.nextNode();
    }
    if (node) range.setStart(node, Math.min(remaining, node.textContent?.length ?? 0));
    else range.setStart(row, row.childNodes.length);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  };
  const sync = () => {
    applyFont();
    if (composing || hasSelectionIn(mirror)) {
      stale = true;
      return;
    }
    const focused = document.activeElement === mirror;
    const selection = focused ? document.getSelection() : null;
    const caret = selection?.isCollapsed ? selection.anchorNode : null;
    const caretRow = caret && Array.from(rows.children).find((row) => row.contains(caret));
    stale = false;
    syncVisibleRows(source, rows);
    markTop();
    if (
      focused &&
      selection?.isCollapsed &&
      (!caret || !rows.contains(caret) || !caretRow?.isConnected)
    ) {
      placeCaretAtCursor();
    }
  };
  const onSelectionChange = () => {
    if (stale && !hasSelectionIn(mirror)) sync();
  };
  const onCompositionStart = () => {
    composing = true;
  };
  const onCompositionEnd = () => {
    composing = false;
  };

  sync();
  const bufferChange = term.buffer.onBufferChange(() => {
    top?.dispose();
    top = undefined;
  });
  const render = term.onRender(sync);
  const scroll = term.onScroll(sync);
  document.addEventListener("selectionchange", onSelectionChange);
  mirror.addEventListener("compositionstart", onCompositionStart);
  mirror.addEventListener("compositionend", onCompositionEnd);

  return {
    mirror,
    rows,
    hasSelection: () => hasSelectionIn(mirror),
    rowsTop: () => (top && !top.isDisposed ? top.line : null),
    releaseSelection: () => {
      const selection = document.getSelection();
      if (selection && hasSelectionIn(mirror)) selection.collapseToEnd();
      sync();
      if (document.activeElement === mirror) placeCaretAtCursor();
    },
    dispose: () => {
      render.dispose();
      scroll.dispose();
      bufferChange.dispose();
      top?.dispose();
      document.removeEventListener("selectionchange", onSelectionChange);
      mirror.removeEventListener("compositionstart", onCompositionStart);
      mirror.removeEventListener("compositionend", onCompositionEnd);
      mirror.remove();
    },
  };
}
