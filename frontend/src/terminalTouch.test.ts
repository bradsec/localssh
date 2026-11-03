import { Terminal } from "@xterm/xterm";
import { describe, expect, it } from "vitest";
import {
  hasSelectionIn,
  syncVisibleRows,
  bufferRange,
  selectionEditBytes,
  recordTypedText,
} from "./terminalTouch.js";

type FakeCell = string | [string, number];

/** A buffer whose rows are cell lists: "" is a never-written cell, [ch, 2] a wide one. */
function fakeTerm(
  rows: { cells: FakeCell[]; wrapped?: boolean }[],
  cursor: { x: number; y: number },
  cols = 10,
  viewportY = 0,
  type: "normal" | "alternate" = "normal",
) {
  const lines = rows.map(({ cells, wrapped }) => {
    const expanded: { getChars: () => string; getWidth: () => number }[] = [];
    for (const cell of cells) {
      if (typeof cell === "string") {
        expanded.push({ getChars: () => cell, getWidth: () => 1 });
      } else {
        expanded.push({ getChars: () => cell[0], getWidth: () => cell[1] });
        expanded.push({ getChars: () => "", getWidth: () => 0 });
      }
    }
    while (expanded.length < cols) expanded.push({ getChars: () => "", getWidth: () => 1 });
    return {
      isWrapped: !!wrapped,
      getCell: (x: number) => expanded[x],
      translateToString: (trim = false, start = 0, end = cols) => {
        const text = expanded
          .slice(start, end)
          .filter((cell) => cell.getWidth() > 0)
          .map((cell) => cell.getChars() || " ")
          .join("");
        return trim ? text.trimEnd() : text;
      },
    };
  });
  return {
    cols,
    buffer: {
      active: {
        type,
        cursorX: cursor.x,
        cursorY: cursor.y,
        baseY: 0,
        viewportY,
        length: lines.length,
        getLine: (y: number) => lines[y],
      },
    },
  } as unknown as Terminal;
}

const chars = (text: string): FakeCell[] => [...text];

describe("recordTypedText", () => {
  it("records printable text, bracketed paste, and DEL", () => {
    expect(recordTypedText("git ", "\x1b[200~check\x1b[201~")).toBe("git check");
    expect(recordTypedText("日本", "\x7f")).toBe("日");
  });

  it("invalidates on navigation, Tab, and multiline paste", () => {
    for (const data of ["\t", "\x1b[A", "\x1b[200~a\nb\x1b[201~", "\x1b[200~a\rb\x1b[201~"]) {
      expect(recordTypedText("hello", data)).toBe(null);
    }
    expect(recordTypedText(null, "next")).toBe(null);
  });
});

describe("selectionEditBytes", () => {
  it("rejects a suggestion past the exact recorded text", () => {
    const term = fakeTerm([{ cells: chars("$ git check") }], { x: 8, y: 0 }, 20);
    const input = { row: 0, col: 2 };
    expect(
      selectionEditBytes(term, input, { row: 0, col: 8 }, { row: 0, col: 11 }, false, "git ch"),
    ).toBe(null);
    expect(
      selectionEditBytes(term, input, { row: 0, col: 6 }, { row: 0, col: 8 }, false, "git ch"),
    ).toBe("\x7f\x7f");
    expect(
      selectionEditBytes(term, input, { row: 0, col: 6 }, { row: 0, col: 8 }, false, null),
    ).toBe(null);
  });
  it("moves to the selection end and deletes each selected character", () => {
    const term = fakeTerm([{ cells: chars("$ abcXYZ") }], { x: 8, y: 0 });
    const input = { row: 0, col: 2 };
    expect(
      selectionEditBytes(term, input, { row: 0, col: 2 }, { row: 0, col: 5 }, false, "abcXYZ"),
    ).toBe("\x1b[D".repeat(3) + "\x7f".repeat(3));
    expect(
      selectionEditBytes(term, input, { row: 0, col: 5 }, { row: 0, col: 8 }, true, "abcXYZ"),
    ).toBe("\x7f".repeat(3));
  });

  it("moves right when the cursor sits before the selection", () => {
    const term = fakeTerm([{ cells: chars("$ abcXYZ") }], { x: 2, y: 0 });
    expect(
      selectionEditBytes(
        term,
        { row: 0, col: 2 },
        { row: 0, col: 4 },
        { row: 0, col: 6 },
        true,
        "abcXYZ",
      ),
    ).toBe("\x1bOC".repeat(4) + "\x7f".repeat(2));
  });

  it("counts a wide character once, not per cell", () => {
    // "$ echo 日本 x": 日 at 7-8, 本 at 9-10, cursor after x.
    const term = fakeTerm(
      [{ cells: [...chars("$ echo "), ["日", 2], ["本", 2], ...chars(" x")] }],
      { x: 13, y: 0 },
      20,
    );
    expect(
      selectionEditBytes(
        term,
        { row: 0, col: 2 },
        { row: 0, col: 9 },
        { row: 0, col: 11 },
        false,
        "echo 日本 x",
      ),
    ).toBe("\x1b[D".repeat(2) + "\x7f");
  });

  it("rejects a selection extending into blank cells after the input", () => {
    const term = fakeTerm([{ cells: chars("$ abc") }], { x: 5, y: 0 });
    expect(
      selectionEditBytes(
        term,
        { row: 0, col: 2 },
        { row: 0, col: 4 },
        { row: 0, col: 7 },
        false,
        "abc",
      ),
    ).toBe(null);
  });

  it("sends nothing when a hard row break lies between the input start and the cursor", () => {
    const term = fakeTerm(
      [{ cells: chars("$ echo a") }, { cells: chars("echo bb") }, { cells: chars("echo c") }],
      { x: 6, y: 2 },
    );
    const input = { row: 0, col: 2 };
    expect(
      selectionEditBytes(term, input, { row: 0, col: 7 }, { row: 1, col: 6 }, false, "echo a"),
    ).toBe(null);
    expect(
      selectionEditBytes(term, input, { row: 2, col: 0 }, { row: 2, col: 4 }, false, "echo a"),
    ).toBe(null);
  });

  it("never treats a right prompt as input", () => {
    // zsh RPROMPT: never-written cells separate the command from the clock.
    const term = fakeTerm(
      [{ cells: [...chars("$ git status"), "", "", "", "", ...chars("12:34")] }],
      { x: 12, y: 0 },
      21,
    );
    const input = { row: 0, col: 2 };
    expect(
      selectionEditBytes(
        term,
        input,
        { row: 0, col: 16 },
        { row: 0, col: 21 },
        false,
        "git status",
      ),
    ).toBe(null);
    // A range crossing into the gap is not wholly inside typed text.
    expect(
      selectionEditBytes(
        term,
        input,
        { row: 0, col: 10 },
        { row: 0, col: 18 },
        false,
        "git status",
      ),
    ).toBe(null);
  });

  it("never treats a completion listing printed after Tab as input", () => {
    const term = fakeTerm(
      [{ cells: chars("$ ls /e") }, { cells: chars("etc  exports") }, { cells: chars("$ ls /e") }],
      { x: 7, y: 2 },
      12,
    );
    const input = { row: 0, col: 2 };
    expect(
      selectionEditBytes(term, input, { row: 1, col: 0 }, { row: 1, col: 3 }, false, null),
    ).toBe(null);
  });

  it("sends nothing in the alternate screen", () => {
    const term = fakeTerm(
      [{ cells: chars("abc") }, { cells: chars("def") }],
      { x: 3, y: 1 },
      10,
      0,
      "alternate",
    );
    expect(
      selectionEditBytes(
        term,
        { row: 0, col: 0 },
        { row: 0, col: 1 },
        { row: 0, col: 2 },
        false,
        "abc",
      ),
    ).toBe(null);
  });

  it("follows a long command onto its wrapped rows after the cursor", () => {
    const term = fakeTerm(
      [{ cells: chars("$ abcdefgh") }, { cells: chars("ijk"), wrapped: true }],
      { x: 4, y: 0 },
    );
    // The cursor reached the end, then moved back after "b"; select "j".
    expect(
      selectionEditBytes(
        term,
        { row: 0, col: 2 },
        { row: 1, col: 1 },
        { row: 1, col: 2 },
        false,
        "abcdefghijk",
      ),
    ).toBe("\x1b[C".repeat(8) + "\x7f");
  });

  it("counts the boundary between wrapped rows as one character position", () => {
    const term = fakeTerm([{ cells: chars("$ abcdefgh") }, { cells: chars("i"), wrapped: true }], {
      x: 1,
      y: 1,
    });
    expect(
      selectionEditBytes(
        term,
        { row: 0, col: 2 },
        { row: 1, col: 0 },
        { row: 1, col: 1 },
        false,
        "abcdefghi",
      ),
    ).toBe("\x7f");
  });

  it("never treats an autosuggestion drawn after the cursor as input", () => {
    // fish: typed "git ch", suggested "eck" drawn after the cursor.
    const term = fakeTerm([{ cells: chars("$ git check") }], { x: 8, y: 0 }, 20);
    const input = { row: 0, col: 2 };
    expect(
      selectionEditBytes(term, input, { row: 0, col: 8 }, { row: 0, col: 11 }, false, "git ch"),
    ).toBe(null);
    expect(
      selectionEditBytes(term, input, { row: 0, col: 6 }, { row: 0, col: 11 }, false, "git ch"),
    ).toBe(null);
    expect(
      selectionEditBytes(term, input, { row: 0, col: 8 }, { row: 0, col: 11 }, false, null),
    ).toBe(null);
  });

  it("counts no newline across a wrapped row", () => {
    const term = fakeTerm(
      [{ cells: chars("$ abcdefgh") }, { cells: chars("ijk"), wrapped: true }],
      { x: 3, y: 1 },
    );
    expect(
      selectionEditBytes(
        term,
        { row: 0, col: 2 },
        { row: 0, col: 8 },
        { row: 1, col: 2 },
        false,
        "abcdefghijk",
      ),
    ).toBe("\x1b[D" + "\x7f".repeat(4));
  });

  it("sends nothing for a selection that starts before the input", () => {
    const term = fakeTerm([{ cells: chars("old output") }, { cells: chars("$ abc") }], {
      x: 5,
      y: 1,
    });
    const input = { row: 1, col: 2 };
    expect(selectionEditBytes(term, input, { row: 0, col: 0 }, { row: 0, col: 3 }, false)).toBe(
      null,
    );
    expect(selectionEditBytes(term, input, { row: 1, col: 0 }, { row: 1, col: 4 }, false)).toBe(
      null,
    );
    expect(selectionEditBytes(term, null, { row: 1, col: 2 }, { row: 1, col: 4 }, false)).toBe(
      null,
    );
  });

  it("sends nothing for a selection of only blank cells after the input", () => {
    const term = fakeTerm([{ cells: chars("$ abc") }], { x: 5, y: 0 });
    expect(
      selectionEditBytes(
        term,
        { row: 0, col: 2 },
        { row: 0, col: 6 },
        { row: 0, col: 8 },
        false,
        "abc",
      ),
    ).toBe(null);
  });

  it("sends nothing once the cursor has moved before the input start", () => {
    const term = fakeTerm([{ cells: chars("$ abc") }], { x: 0, y: 0 });
    expect(
      selectionEditBytes(term, { row: 0, col: 2 }, { row: 0, col: 2 }, { row: 0, col: 4 }, false),
    ).toBe(null);
  });
});

describe("bufferRange", () => {
  it("maps a range in the mirrored rows to buffer cells from the rows' top line", () => {
    const rows = document.createElement("div");
    rows.innerHTML = "<div>old</div><div>界a</div>";
    document.body.append(rows);
    const text = rows.children[1]!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 1);
    // The live viewport is at line 0, but the frozen rows show lines 1 and 2.
    const term = fakeTerm(
      [{ cells: [] }, { cells: chars("old") }, { cells: [["界", 2], "a"] }],
      { x: 3, y: 1 },
      3,
      0,
    );
    expect(bufferRange(term, rows, 1, range)).toEqual({
      start: { row: 2, col: 0 },
      end: { row: 2, col: 2 },
    });
    range.setStart(rows.children[0]!.firstChild!, 1);
    expect(bufferRange(term, rows, 1, range)).toEqual({
      start: { row: 1, col: 1 },
      end: { row: 2, col: 2 },
    });
    // A frozen row whose live line has changed since cannot be mapped.
    rows.children[1]!.firstChild!.textContent = "界b";
    expect(bufferRange(term, rows, 1, range)).toBeNull();
    rows.children[1]!.firstChild!.textContent = "界a";
    range.collapse(true);
    expect(bufferRange(term, rows, 1, range)).toBeNull();
    const outside = document.createElement("p");
    outside.textContent = "x";
    document.body.append(outside);
    range.selectNodeContents(outside);
    expect(bufferRange(term, rows, 1, range)).toBeNull();
    rows.remove();
    outside.remove();
  });
});

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

describe("xterm paste", () => {
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
    term.paste("one");
    term.write("\x1b[?2004h", () => {});
    return new Promise<void>((resolve) => {
      term.write("", () => {
        term.paste("two");
        expect(sent).toEqual(["one", "\x1b[200~two\x1b[201~"]);
        term.dispose();
        resolve();
      });
    });
  });
});
