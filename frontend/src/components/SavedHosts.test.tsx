import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SavedHosts } from "./SavedHosts.js";
import type { VaultApi } from "../vault/useVault.js";

const entries = [
  { id: "a", nickname: "web", host: "10.0.0.4", port: 22, username: "deploy", hasPassword: true },
  { id: "b", nickname: "nas", host: "10.0.0.20", port: 22, hasPassword: false },
];

function vaultApi(overrides: Partial<VaultApi> = {}): VaultApi {
  return {
    status: "unlocked",
    entries,
    busy: false,
    error: null,
    create: vi.fn().mockResolvedValue(true),
    unlock: vi.fn().mockResolvedValue(true),
    save: vi.fn().mockResolvedValue(true),
    remove: vi.fn().mockResolvedValue(true),
    changePassword: vi.fn().mockResolvedValue(true),
    lock: vi.fn().mockResolvedValue(true),
    reset: vi.fn(),
    clearError: vi.fn(),
    ...overrides,
  };
}

const current = { host: "10.0.0.9", port: 22, username: "pi" };

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
});

describe("SavedHosts", () => {
  it("renders nothing when storage is unavailable", () => {
    const { container } = render(
      <SavedHosts vault={vaultApi({ status: "unavailable" })} current={current} onPick={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("offers to set a master password when no vault exists", () => {
    render(
      <SavedHosts
        vault={vaultApi({ status: "absent", entries: [] })}
        current={current}
        onPick={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/^master password$/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create/i })).toBeInTheDocument();
  });

  it("gives password managers a stable hidden vault identity", () => {
    const { container } = render(
      <SavedHosts
        vault={vaultApi({ status: "absent", entries: [] })}
        current={current}
        onPick={vi.fn()}
      />,
    );

    const username = container.querySelector<HTMLInputElement>('input[autocomplete="username"]');
    expect(username).toHaveValue("localssh-vault");
    expect(username).toHaveAttribute("name", "username");
    expect(username).toHaveAttribute("hidden");
  });

  it("requires the two master passwords to match", async () => {
    const vault = vaultApi({ status: "absent", entries: [] });
    render(<SavedHosts vault={vault} current={current} onPick={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/^master password$/i), "one password");
    await userEvent.type(screen.getByLabelText(/confirm/i), "another password");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(vault.create).not.toHaveBeenCalled();
    expect(screen.getByText(/do not match/i)).toBeInTheDocument();
  });

  it("rates the master password as it is typed", async () => {
    render(
      <SavedHosts
        vault={vaultApi({ status: "absent", entries: [] })}
        current={current}
        onPick={vi.fn()}
      />,
    );

    await userEvent.type(screen.getByLabelText(/^master password$/i), "short");

    expect(screen.getByRole("status")).toHaveTextContent(/weak/i);
  });

  // The meter is guidance. It must never stand between the user and their vault.
  it("still creates a vault the meter rates weak", async () => {
    const vault = vaultApi({ status: "absent", entries: [] });
    render(<SavedHosts vault={vault} current={current} onPick={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/^master password$/i), "password");
    await userEvent.type(screen.getByLabelText(/confirm/i), "password");

    const submit = screen.getByRole("button", { name: /create/i });
    expect(submit).toBeEnabled();

    await userEvent.click(submit);
    expect(vault.create).toHaveBeenCalledWith("password");
  });

  it("creates the vault when they match", async () => {
    const vault = vaultApi({ status: "absent", entries: [] });
    render(<SavedHosts vault={vault} current={current} onPick={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/^master password$/i), "a good master password");
    await userEvent.type(screen.getByLabelText(/confirm/i), "a good master password");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(vault.create).toHaveBeenCalledWith("a good master password");
  });

  it("asks for the master password when locked", () => {
    render(
      <SavedHosts vault={vaultApi({ status: "locked" })} current={current} onPick={vi.fn()} />,
    );

    expect(screen.getByLabelText(/master password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /unlock/i })).toBeInTheDocument();
    expect(screen.queryByText("web")).not.toBeInTheDocument();
  });

  it("unlocks", async () => {
    const vault = vaultApi({ status: "locked" });
    render(<SavedHosts vault={vault} current={current} onPick={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/master password/i), "master password");
    await userEvent.click(screen.getByRole("button", { name: /unlock/i }));

    expect(vault.unlock).toHaveBeenCalledWith("master password");
  });

  it("shows the vault error", () => {
    render(
      <SavedHosts
        vault={vaultApi({ status: "locked", error: "That master password is not correct." })}
        current={current}
        onPick={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/not correct/i);
  });

  it("lists entries once unlocked", () => {
    render(<SavedHosts vault={vaultApi()} current={current} onPick={vi.fn()} />);

    expect(screen.getByRole("button", { name: /^web\b/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^nas\b/i })).toBeInTheDocument();
  });

  it("keeps contextual control names while adding decorative icons", async () => {
    render(<SavedHosts vault={vaultApi()} current={current} onPick={vi.fn()} />);

    const options = screen.getByRole("button", { name: "Options for web" });
    expect(options.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    await userEvent.click(options);

    for (const name of ["Edit", "Delete"]) {
      const action = screen.getByRole("button", { name });
      expect(action).not.toHaveAttribute("aria-label");
      expect(action.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    }

    const add = screen.getByRole("button", { name: "Add current" });
    expect(add).not.toHaveAttribute("aria-label");
    expect(add.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("marks only a locked vault with a decorative lock", () => {
    const { unmount } = render(
      <SavedHosts vault={vaultApi({ status: "locked" })} current={current} onPick={vi.fn()} />,
    );

    const lockedTitle = screen.getByRole("heading", { name: "Saved hosts" });
    expect(lockedTitle.querySelector("svg")).toHaveAttribute("aria-hidden", "true");

    unmount();
    render(<SavedHosts vault={vaultApi()} current={current} onPick={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Saved hosts" }).querySelector("svg")).toBeNull();
  });

  it("picks an entry", async () => {
    const onPick = vi.fn();
    render(<SavedHosts vault={vaultApi()} current={current} onPick={onPick} />);

    await userEvent.click(screen.getByRole("button", { name: /^web\b/i }));

    expect(onPick).toHaveBeenCalledWith(entries[0]);
  });

  it("prompts to add a host when the vault is empty", () => {
    render(<SavedHosts vault={vaultApi({ entries: [] })} current={current} onPick={vi.fn()} />);

    expect(screen.getByText(/no saved hosts yet/i)).toBeInTheDocument();
    expect(screen.getByText("0 hosts")).toBeInTheDocument();
  });

  it("lets the user manually lock an unlocked vault", async () => {
    const vault = vaultApi();
    render(<SavedHosts vault={vault} current={current} onPick={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /^lock$/i }));

    expect(vault.lock).toHaveBeenCalledOnce();
  });

  it("opens the editor pre-filled from the connect form", async () => {
    render(<SavedHosts vault={vaultApi()} current={current} onPick={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /add current/i }));

    expect(screen.getByLabelText(/^host$/i)).toHaveValue("10.0.0.9");
  });

  it("deletes an entry after a confirmation", async () => {
    const vault = vaultApi();
    render(<SavedHosts vault={vault} current={current} onPick={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /options for web/i }));
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    await userEvent.click(screen.getByRole("button", { name: /delete web/i }));

    expect(vault.remove).toHaveBeenCalledWith("a");
  });

  it("contains focus in the delete dialog and restores it on Escape", async () => {
    const user = userEvent.setup();
    render(<SavedHosts vault={vaultApi()} current={current} onPick={vi.fn()} />);
    const options = screen.getByRole("button", { name: /options for web/i });
    await user.click(options);
    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    const dialog = screen.getByRole("alertdialog", { name: /remove web/i });
    const cancel = screen.getByRole("button", { name: /^cancel$/i });
    const confirm = screen.getByRole("button", { name: /delete web/i });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(cancel).toHaveFocus();

    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await vi.waitFor(() => expect(options).toHaveFocus());
  });

  it("changes the master password when the confirmation matches", async () => {
    const vault = vaultApi();
    render(<SavedHosts vault={vault} current={current} onPick={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /change master password/i }));
    await userEvent.type(screen.getByLabelText(/current master password/i), "old master password");
    await userEvent.type(screen.getByLabelText(/^new master password$/i), "new master password");
    await userEvent.type(
      screen.getByLabelText(/confirm new master password/i),
      "new master password",
    );
    await userEvent.click(screen.getByRole("button", { name: /^change$/i }));

    expect(vault.changePassword).toHaveBeenCalledWith("old master password", "new master password");
  });

  it("refuses a master password change whose confirmation differs", async () => {
    const vault = vaultApi();
    render(<SavedHosts vault={vault} current={current} onPick={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /change master password/i }));
    await userEvent.type(screen.getByLabelText(/current master password/i), "old master password");
    await userEvent.type(screen.getByLabelText(/^new master password$/i), "one password");
    await userEvent.type(screen.getByLabelText(/confirm new master password/i), "another password");
    await userEvent.click(screen.getByRole("button", { name: /^change$/i }));

    expect(vault.changePassword).not.toHaveBeenCalled();
    expect(screen.getByText(/do not match/i)).toBeInTheDocument();
  });

  it("resets the vault only after the confirmation phrase is typed", async () => {
    const vault = vaultApi({ status: "locked" });
    render(<SavedHosts vault={vault} current={current} onPick={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /forgotten|reset/i }));
    await userEvent.click(screen.getByRole("button", { name: /delete the vault/i }));
    expect(vault.reset).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText(/type delete/i), "DELETE");
    await userEvent.click(screen.getByRole("button", { name: /delete the vault/i }));
    expect(vault.reset).toHaveBeenCalled();
  });

  it("yields a frame before starting a master password derivation", async () => {
    let paint: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      paint = callback;
      return 0;
    });
    const vault = vaultApi({ status: "absent", entries: [] });
    render(<SavedHosts vault={vault} current={current} onPick={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/^master password$/i), "master password");
    await userEvent.type(screen.getByLabelText(/confirm/i), "master password");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(vault.create).not.toHaveBeenCalled();

    paint?.(0);
    await vi.waitFor(() => expect(vault.create).toHaveBeenCalledWith("master password"));
  });
});
