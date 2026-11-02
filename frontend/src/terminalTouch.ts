import type { Terminal } from "@xterm/xterm";

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

/** Sends pasted clipboard text to the terminal's paste path and keeps the field itself empty. */
export function pasteTerminalText(event: ClipboardEvent, paste: (text: string) => void): void {
  const text = event.clipboardData?.getData("text") ?? "";
  if (!text) return;
  // Stopping the event keeps xterm's own paste listener from sending it again.
  event.preventDefault();
  event.stopPropagation();
  paste(text);
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

function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y);
    return position ? { node: position.offsetNode, offset: position.offset } : null;
  }
  const range = document.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

/**
 * Selects the word under a point inside `root`. Returns false when the point is
 * not over text, so a long press on empty space selects nothing.
 *
 * Touch Safari starts a selection by itself on a long press. This is the
 * fallback for a browser that does not, and it is skipped when a selection
 * already exists.
 */
export function selectWordAt(root: Element, x: number, y: number): boolean {
  const caret = caretAt(x, y);
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE || !root.contains(caret.node)) return false;
  const text = caret.node.textContent ?? "";
  const isWordChar = (char: string | undefined) => !!char && /\S/.test(char);
  let offset = caret.offset;
  if (!isWordChar(text[offset]) && isWordChar(text[offset - 1])) offset -= 1;
  if (!isWordChar(text[offset])) return false;
  let start = offset;
  let end = offset + 1;
  while (start > 0 && isWordChar(text[start - 1])) start -= 1;
  while (end < text.length && isWordChar(text[end])) end += 1;
  const range = document.createRange();
  range.setStart(caret.node, start);
  range.setEnd(caret.node, end);
  const selection = document.getSelection();
  if (!selection) return false;
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

export interface TouchTextLayer {
  /** The selectable copy of the visible rows. */
  mirror: HTMLElement;
  hasSelection: () => boolean;
  dispose: () => void;
}

/**
 * Lays an invisible, selectable copy of the visible rows over the terminal so a
 * touch device can use its own text selection. The copy takes the terminal's
 * font options, and each cloned row brings xterm's inline width and height, so
 * the cells line up. It is rebuilt after every render and scroll. While a selection exists the copy
 * stops updating, because replacing a row would drop the selection under the
 * user's finger.
 */
export function attachTouchTextLayer(term: Terminal): TouchTextLayer | null {
  const screen = term.element?.querySelector(".xterm-screen");
  const source = screen?.querySelector(".xterm-rows");
  if (!screen || !source) return null;

  const mirror = document.createElement("div");
  mirror.className = "terminal-touch-text";
  // xterm's accessibility tree already announces the output.
  mirror.setAttribute("aria-hidden", "true");
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
  const sync = () => {
    applyFont();
    if (hasSelectionIn(mirror)) {
      stale = true;
      return;
    }
    stale = false;
    syncVisibleRows(source, mirror);
  };
  const onSelectionChange = () => {
    if (stale && !hasSelectionIn(mirror)) sync();
  };

  sync();
  const render = term.onRender(sync);
  const scroll = term.onScroll(sync);
  document.addEventListener("selectionchange", onSelectionChange);

  return {
    mirror,
    hasSelection: () => hasSelectionIn(mirror),
    dispose: () => {
      render.dispose();
      scroll.dispose();
      document.removeEventListener("selectionchange", onSelectionChange);
      mirror.remove();
    },
  };
}
