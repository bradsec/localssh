import { Terminal } from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";
import {
  hasSelectionIn,
  pasteTerminalText,
  selectWordAt,
  syncVisibleRows,
} from "./terminalTouch.js";

describe("syncVisibleRows", () => {
  it("mirrors rendered rows and removes rows after a resize", () => {
    const source = document.createElement("div");
    const mirror = document.createElement("div");
    source.innerHTML = '<div><span style="color: red">one</span></div><div>two</div>';
    syncVisibleRows(source, mirror);
    expect(mirror.innerHTML).toBe(source.innerHTML);
    expect(mirror.children[0]).not.toBe(source.children[0]);

    source.innerHTML = "<div>new</div>";
    syncVisibleRows(source, mirror);
    expect(mirror.innerHTML).toBe("<div>new</div>");
  });

  it("keeps the elements of rows that did not change", () => {
    const source = document.createElement("div");
    const mirror = document.createElement("div");
    source.innerHTML = "<div>one</div><div>two</div>";
    syncVisibleRows(source, mirror);
    const [first, second] = [mirror.children[0], mirror.children[1]];

    source.children[1]!.textContent = "changed";
    syncVisibleRows(source, mirror);
    expect(mirror.children[0]).toBe(first);
    expect(mirror.children[1]).not.toBe(second);
    expect(mirror.innerHTML).toBe(source.innerHTML);
  });

  it("grows when rows are added", () => {
    const source = document.createElement("div");
    const mirror = document.createElement("div");
    syncVisibleRows(source, mirror);
    source.innerHTML = "<div>a</div><div>b</div>";
    syncVisibleRows(source, mirror);
    expect(mirror.children).toHaveLength(2);
  });
});

describe("hasSelectionIn", () => {
  it("is true only for a non-empty selection inside the root", () => {
    const root = document.createElement("div");
    root.innerHTML = "<div>hello world</div>";
    const other = document.createElement("p");
    other.textContent = "elsewhere";
    document.body.append(root, other);

    const select = (node: Node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      document.getSelection()!.removeAllRanges();
      document.getSelection()!.addRange(range);
    };

    expect(hasSelectionIn(root)).toBe(false);
    select(root);
    expect(hasSelectionIn(root)).toBe(true);
    select(other);
    expect(hasSelectionIn(root)).toBe(false);
    document.getSelection()!.removeAllRanges();
    root.remove();
    other.remove();
  });
});

describe("selectWordAt", () => {
  it("selects nothing when the point is not over text", () => {
    const root = document.createElement("div");
    document.body.append(root);
    // jsdom has no caret lookup, which is the same answer as empty space.
    expect(selectWordAt(root, 1, 1)).toBe(false);
    root.remove();
  });
});

describe("pasteTerminalText", () => {
  const pasteEvent = (text: string) => {
    const event = new Event("paste", { cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
    return event;
  };

  it("routes clipboard text through terminal paste and prevents editable mutation", () => {
    const paste = vi.fn();
    const event = pasteEvent("echo hi\n");
    pasteTerminalText(event, paste);
    expect(event.defaultPrevented).toBe(true);
    expect(paste).toHaveBeenCalledWith("echo hi\n");
  });

  it("ignores an empty clipboard", () => {
    const paste = vi.fn();
    const event = pasteEvent("");
    pasteTerminalText(event, paste);
    expect(paste).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("reaches the shell as bracketed paste only when the session enabled it", () => {
    window.matchMedia ??= (() => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })) as unknown as typeof window.matchMedia;
    const term = new Terminal();
    term.open(document.createElement("div"));
    const sent: string[] = [];
    term.onData((data) => sent.push(data));
    const paste = (text: string) => term.paste(text);

    pasteTerminalText(pasteEvent("one"), paste);
    term.write("\x1b[?2004h", () => {});
    return new Promise<void>((resolve) => {
      term.write("", () => {
        pasteTerminalText(pasteEvent("two"), paste);
        expect(sent).toEqual(["one", "\x1b[200~two\x1b[201~"]);
        term.dispose();
        resolve();
      });
    });
  });
});
