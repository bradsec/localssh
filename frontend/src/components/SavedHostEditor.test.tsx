import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SavedHostEditor } from "./SavedHostEditor.js";

const saved = {
  id: "a",
  nickname: "web",
  host: "10.0.0.4",
  port: 22,
  username: "deploy",
  hasPassword: true,
};

describe("SavedHostEditor", () => {
  it("saves a host-only entry", async () => {
    const onSave = vi.fn();
    render(<SavedHostEditor entry={null} busy={false} onSave={onSave} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/nickname/i), "nas");
    await userEvent.type(screen.getByLabelText(/^host$/i), "10.0.0.20");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ nickname: "nas", host: "10.0.0.20", port: 22, username: "" }),
    );
  });

  it("hides the username and password fields at the host-only level", () => {
    render(<SavedHostEditor entry={null} busy={false} onSave={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.queryByLabelText(/^username$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^password$/i)).not.toBeInTheDocument();
    expect(screen.getByText("Save the host and port.")).toBeInTheDocument();
  });

  it("reveals the username field at the username level", async () => {
    render(<SavedHostEditor entry={null} busy={false} onSave={vi.fn()} onCancel={vi.fn()} />);

    await userEvent.click(screen.getByRole("radio", { name: /host and username/i }));

    expect(screen.getByLabelText(/^username$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^password$/i)).not.toBeInTheDocument();
    expect(screen.getByText("Save the host, port and username.")).toBeInTheDocument();
  });

  it("opens an existing entry at its derived level", () => {
    render(<SavedHostEditor entry={saved} busy={false} onSave={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole("radio", { name: /host, username and password/i })).toBeChecked();
    expect(screen.getByLabelText(/nickname/i)).toHaveValue("web");
    expect(screen.getByLabelText(/^username$/i)).toHaveValue("deploy");
  });

  // The stored password never reaches the page, so the field cannot show it.
  it("shows an empty password field with a keep note for a saved password", () => {
    render(<SavedHostEditor entry={saved} busy={false} onSave={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByLabelText(/password/i, { selector: "input[type=password]" })).toHaveValue(
      "",
    );
    expect(screen.getByText(/leave blank to keep the saved password/i)).toBeInTheDocument();
  });

  // Absent means keep. This is the contract Task 7 encodes.
  it("omits the password when the field is left blank on an existing entry", async () => {
    const onSave = vi.fn();
    render(<SavedHostEditor entry={saved} busy={false} onSave={onSave} onCancel={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onSave).toHaveBeenCalled();
    expect("password" in (onSave.mock.calls[0]![0] as object)).toBe(false);
  });

  it("sends the new password when the field is filled in", async () => {
    const onSave = vi.fn();
    render(<SavedHostEditor entry={saved} busy={false} onSave={onSave} onCancel={vi.fn()} />);

    await userEvent.type(
      screen.getByLabelText(/password/i, { selector: "input[type=password]" }),
      "newpass",
    );
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ password: "newpass" }));
  });

  // Lowering the level must actively clear, not merely hide.
  it("clears the saved password when the level drops to username only", async () => {
    const onSave = vi.fn();
    render(<SavedHostEditor entry={saved} busy={false} onSave={onSave} onCancel={vi.fn()} />);

    await userEvent.click(screen.getByRole("radio", { name: /host and username/i }));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ password: "" }));
  });

  it("clears the username and password when the level drops to host only", async () => {
    const onSave = vi.fn();
    render(<SavedHostEditor entry={saved} busy={false} onSave={onSave} onCancel={vi.fn()} />);

    await userEvent.click(screen.getByRole("radio", { name: /host only/i }));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ username: "", password: "" }));
  });

  it("requires a nickname and a host", async () => {
    const onSave = vi.fn();
    render(<SavedHostEditor entry={null} busy={false} onSave={onSave} onCancel={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(onSave).not.toHaveBeenCalled();
  });

  it("pre-fills from the connect form when asked", () => {
    render(
      <SavedHostEditor
        entry={null}
        initial={{ host: "10.0.0.9", port: 2222, username: "pi" }}
        busy={false}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/^host$/i)).toHaveValue("10.0.0.9");
    expect(screen.getByLabelText(/^port$/i)).toHaveValue(2222);
  });

  it("cancels", async () => {
    const onCancel = vi.fn();
    render(<SavedHostEditor entry={null} busy={false} onSave={vi.fn()} onCancel={onCancel} />);

    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onCancel).toHaveBeenCalled();
  });
});
