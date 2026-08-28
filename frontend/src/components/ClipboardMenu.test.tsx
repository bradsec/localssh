import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClipboardMenu } from "./ClipboardMenu.js";

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, "clipboard", { value, configurable: true });
}

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

describe("ClipboardMenu", () => {
  it("keeps the copy action disabled until the terminal has a selection", () => {
    const { rerender } = render(
      <ClipboardMenu hasSelection={false} getSelection={() => ""} onPaste={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Copy selection" })).toBeDisabled();

    rerender(<ClipboardMenu hasSelection getSelection={() => "output"} onPaste={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Copy selection" })).toBeEnabled();
  });

  it("copies the current selection and confirms it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    render(<ClipboardMenu hasSelection getSelection={() => "line one"} onPaste={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Copy selection" }));

    expect(writeText).toHaveBeenCalledWith("line one");
    expect(await screen.findByText("Copied the selection.")).toBeInTheDocument();
  });

  it("reports when the browser blocks the copy", async () => {
    setClipboard(undefined);
    setExecCommand(vi.fn().mockReturnValue(false));
    render(<ClipboardMenu hasSelection getSelection={() => "line one"} onPaste={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Copy selection" }));

    expect(await screen.findByText("The browser blocked the copy.")).toBeInTheDocument();
  });

  it("forwards text pasted into the field to the session", async () => {
    const onPaste = vi.fn();
    render(<ClipboardMenu hasSelection={false} getSelection={() => ""} onPaste={onPaste} />);

    const field = screen.getByLabelText("Paste here");
    await userEvent.click(field);
    await userEvent.paste("echo hi");

    expect(onPaste).toHaveBeenCalledWith("echo hi");
  });

  it("sends the field contents with the Send box button", async () => {
    const onPaste = vi.fn();
    render(<ClipboardMenu hasSelection={false} getSelection={() => ""} onPaste={onPaste} />);

    const field = screen.getByLabelText("Paste here");
    await userEvent.type(field, "manual text");
    await userEvent.click(screen.getByRole("button", { name: "Send box" }));

    expect(onPaste).toHaveBeenCalledWith("manual text");
  });

  it("points at the manual field when the clipboard cannot be read", async () => {
    setClipboard(undefined);
    const onPaste = vi.fn();
    render(<ClipboardMenu hasSelection={false} getSelection={() => ""} onPaste={onPaste} />);

    await userEvent.click(screen.getByRole("button", { name: "Paste from clipboard" }));

    expect(await screen.findByText("Paste into the box below instead.")).toBeInTheDocument();
    expect(onPaste).not.toHaveBeenCalled();
  });

  it("names its state for assistive tech through the summary", () => {
    const { rerender } = render(
      <ClipboardMenu hasSelection getSelection={() => "x"} onPaste={vi.fn()} />,
    );
    expect(
      screen.getByRole("button", { name: "Clipboard, selection ready to copy" }),
    ).toBeInTheDocument();

    rerender(<ClipboardMenu hasSelection={false} getSelection={() => ""} onPaste={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Clipboard" })).toBeInTheDocument();
  });
});
