import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { KeyBarEditor } from "./KeyBarEditor.js";
import { DEFAULT_KEY_ORDER } from "../terminalKeys.js";

function Harness({
  initial = ["ctrl", "esc", "tab", "up"],
  capacity,
  onChange = vi.fn(() => ({ ok: true })),
  onBack = vi.fn(),
  onClose = vi.fn(),
}: {
  initial?: string[];
  capacity?: number;
  onChange?: (order: string[]) => { ok: boolean };
  onBack?: () => void;
  onClose?: () => void;
}) {
  const [order, setOrder] = useState(initial);
  return (
    <KeyBarEditor
      order={order}
      capacity={capacity}
      onChange={(next) => {
        setOrder(next);
        return onChange(next);
      }}
      onBack={onBack}
      onClose={onClose}
    />
  );
}

const rowNames = () =>
  screen.getAllByRole("button", { name: /^Move .* up$/ }).map((b) => b.getAttribute("aria-label"));

describe("KeyBarEditor", () => {
  it("moves a key down, keeps focus on its Move down control and announces the position", async () => {
    const onChange = vi.fn(() => ({ ok: true }));
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    const down = screen.getByRole("button", { name: "Move ctrl down" });
    await user.click(down);
    expect(onChange).toHaveBeenLastCalledWith(["esc", "ctrl", "tab", "up"]);
    expect(screen.getByRole("button", { name: "Move ctrl down" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("ctrl moved to position 2 of 4.");
  });

  it("moves a key up using its spoken name", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Move Up arrow up" }));
    expect(rowNames()).toEqual([
      "Move ctrl up",
      "Move Escape up",
      "Move Up arrow up",
      "Move Tab up",
    ]);
    expect(screen.getByRole("button", { name: "Move Up arrow up" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Up arrow moved to position 3 of 4.");
  });

  it("keeps end buttons focusable, aria-disabled and inert", async () => {
    const onChange = vi.fn(() => ({ ok: true }));
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    const first = screen.getByRole("button", { name: "Move ctrl up" });
    expect(first).toHaveAttribute("aria-disabled", "true");
    expect(first).not.toBeDisabled();
    await user.click(first);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Move Up arrow down" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    // A key moved to the end leaves its Move down control disabled but focused.
    await user.click(screen.getByRole("button", { name: "Move Tab down" }));
    const moved = screen.getByRole("button", { name: "Move Tab down" });
    expect(moved).toHaveAttribute("aria-disabled", "true");
    expect(moved).toHaveFocus();
  });

  it("removes a key into Not in key bar and adds it back at the end", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn(() => ({ ok: true }));
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Remove Escape from the key bar" }));
    expect(onChange).toHaveBeenLastCalledWith(["ctrl", "tab", "up"]);
    expect(screen.getByRole("status")).toHaveTextContent("Escape removed.");
    expect(screen.getByRole("button", { name: "Remove Tab from the key bar" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Add Escape to the key bar" }));
    expect(onChange).toHaveBeenLastCalledWith(["ctrl", "tab", "up", "esc"]);
    expect(screen.getByRole("status")).toHaveTextContent("Escape added.");
    expect(screen.getByRole("button", { name: "Remove Escape from the key bar" })).toHaveFocus();
  });

  it("removes the last key and keeps focus inside the editor", async () => {
    const user = userEvent.setup();
    render(<Harness initial={["ctrl"]} />);
    await user.click(screen.getByRole("button", { name: "Remove ctrl from the key bar" }));
    expect(screen.queryByRole("button", { name: /^Move/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(document.activeElement).not.toBe(document.body);
  });

  it("resets to the default order and announces it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn(() => ({ ok: true }));
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Reset key bar" }));
    expect(onChange).toHaveBeenLastCalledWith([...DEFAULT_KEY_ORDER]);
    expect(screen.getByRole("status")).toHaveTextContent("Key bar reset to the default keys.");
  });

  it("draws the divider after the first <capacity> keys, and none when all fit", () => {
    const { rerender } = render(<Harness capacity={2} />);
    const items = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    const divider = items.findIndex((t) => t.includes("Below this line: in More keys"));
    expect(divider).toBe(2);
    rerender(<Harness capacity={4} />);
    expect(screen.queryByText(/Below this line/)).toBeNull();
  });

  it("states that Keyboard is always first, and wires Settings and Close", async () => {
    const onBack = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onBack={onBack} onClose={onClose} />);
    expect(screen.getByText("always first")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(onBack).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("reports a save failure in the status", async () => {
    const user = userEvent.setup();
    render(<Harness onChange={() => ({ ok: false })} />);
    await user.click(screen.getByRole("button", { name: "Move ctrl down" }));
    expect(screen.getByRole("status")).toHaveTextContent("Could not save on this device.");
  });
});
