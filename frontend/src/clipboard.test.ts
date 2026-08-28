import { afterEach, describe, expect, it, vi } from "vitest";
import { readClipboardText, writeClipboardText } from "./clipboard.js";

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, "clipboard", { value, configurable: true });
}

// jsdom does not implement execCommand, so the fallback path needs one planted.
function setExecCommand(fn: ((command: string) => boolean) | undefined) {
  if (fn) {
    Object.defineProperty(document, "execCommand", { value: fn, configurable: true });
  } else {
    delete (document as { execCommand?: unknown }).execCommand;
  }
}

afterEach(() => {
  setClipboard(undefined);
  setExecCommand(undefined);
  vi.restoreAllMocks();
});

describe("writeClipboardText", () => {
  it("does nothing for empty text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    expect(await writeClipboardText("")).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("uses the async Clipboard API when it is available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    expect(await writeClipboardText("ls -la")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("ls -la");
  });

  it("falls back to execCommand when the Clipboard API rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("not allowed"));
    setClipboard({ writeText });
    const execCommand = vi.fn().mockReturnValue(true);
    setExecCommand(execCommand);

    expect(await writeClipboardText("payload")).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("falls back to execCommand when there is no Clipboard API", async () => {
    setClipboard(undefined);
    const execCommand = vi.fn().mockReturnValue(true);
    setExecCommand(execCommand);

    expect(await writeClipboardText("payload")).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("reports failure when execCommand cannot copy", async () => {
    setClipboard(undefined);
    setExecCommand(vi.fn().mockReturnValue(false));

    expect(await writeClipboardText("payload")).toBe(false);
  });

  it("reports failure when the platform has no copy path at all", async () => {
    setClipboard(undefined);
    setExecCommand(undefined);

    expect(await writeClipboardText("payload")).toBe(false);
  });
});

describe("readClipboardText", () => {
  it("returns null when the browser exposes no reader", async () => {
    setClipboard(undefined);
    expect(await readClipboardText()).toBeNull();
  });

  it("returns the clipboard contents when the reader resolves", async () => {
    setClipboard({ readText: vi.fn().mockResolvedValue("pasted") });
    expect(await readClipboardText()).toBe("pasted");
  });

  it("returns null when the reader is refused", async () => {
    setClipboard({ readText: vi.fn().mockRejectedValue(new Error("denied")) });
    expect(await readClipboardText()).toBeNull();
  });
});
