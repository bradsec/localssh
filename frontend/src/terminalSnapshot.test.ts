import { describe, expect, it } from "vitest";
import type { IBuffer } from "@xterm/xterm";
import { snapshotTerminalText } from "./terminalSnapshot.js";

function fakeBuffer(lines: { text: string; wrapped?: boolean }[]): IBuffer {
  return {
    length: lines.length,
    getLine: (index: number) => {
      const line = lines[index];
      if (!line) return undefined;
      return {
        isWrapped: line.wrapped ?? false,
        translateToString: (trimRight?: boolean) => (trimRight ? line.text.trimEnd() : line.text),
      };
    },
  } as IBuffer;
}

describe("snapshotTerminalText", () => {
  it("joins soft wraps and separates hard lines", () => {
    expect(
      snapshotTerminalText(
        fakeBuffer([{ text: "long " }, { text: "line", wrapped: true }, { text: "next" }]),
      ),
    ).toBe("long line\nnext");
  });

  it("keeps Unicode, blank lines, and trailing spaces", () => {
    expect(
      snapshotTerminalText(fakeBuffer([{ text: "界🙂 " }, { text: "" }, { text: "end  " }])),
    ).toBe("界🙂 \n\nend  ");
  });

  it("reads only the supplied active buffer and no ANSI or accessibility text", () => {
    const buffers = {
      normal: fakeBuffer([{ text: "normal output" }]),
      alternate: fakeBuffer([{ text: "alternate output" }]),
    };
    let active = buffers.normal;
    expect(snapshotTerminalText(active)).toBe("normal output");
    active = buffers.alternate;
    const snapshot = snapshotTerminalText(active);
    expect(snapshot).toBe("alternate output");
    expect(snapshot).not.toContain(String.fromCharCode(27));
    expect(snapshot).not.toContain("accessibility");
  });

  it("reads only retained lines", () => {
    expect(snapshotTerminalText(fakeBuffer([]))).toBe("");
    expect(snapshotTerminalText(fakeBuffer([{ text: "retained" }]))).toBe("retained");
  });
});
