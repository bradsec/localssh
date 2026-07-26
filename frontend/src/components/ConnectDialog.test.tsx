import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectDialog } from "./ConnectDialog.js";
import type { VaultApi } from "../vault/useVault.js";

const entries = [
  { id: "a", nickname: "web", host: "10.0.0.4", port: 22, username: "deploy", hasPassword: true },
  { id: "b", nickname: "half", host: "10.0.0.5", port: 22, username: "deploy", hasPassword: false },
  { id: "c", nickname: "bare", host: "10.0.0.6", port: 22, hasPassword: false },
];

function vaultApi(overrides: Partial<VaultApi> = {}): VaultApi {
  return {
    status: "unlocked",
    entries,
    busy: false,
    error: null,
    create: vi.fn(),
    unlock: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
    changePassword: vi.fn(),
    lock: vi.fn(),
    reset: vi.fn(),
    clearError: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => localStorage.clear());

describe("ConnectDialog", () => {
  it("connects with a typed password", async () => {
    const onConnect = vi.fn();
    render(<ConnectDialog vault={vaultApi()} onConnect={onConnect} disabled={false} />);

    await userEvent.type(screen.getByLabelText(/^host$/i), "10.0.0.9");
    await userEvent.type(screen.getByLabelText(/^username$/i), "pi");
    await userEvent.type(screen.getByLabelText(/^password$/i), "hunter2");
    await userEvent.click(screen.getByRole("button", { name: /^connect$/i }));

    expect(onConnect).toHaveBeenCalledWith({
      host: "10.0.0.9",
      port: 22,
      username: "pi",
      password: { kind: "typed", value: "hunter2" },
    });
  });

  // A saved password never reaches the page, so picking that entry connects
  // straight away by reference.
  it("connects immediately by reference when the entry stores a password", async () => {
    const onConnect = vi.fn();
    render(<ConnectDialog vault={vaultApi()} onConnect={onConnect} disabled={false} />);

    await userEvent.click(screen.getByRole("button", { name: /^web:/i }));

    expect(onConnect).toHaveBeenCalledWith({
      host: "10.0.0.4",
      port: 22,
      username: "deploy",
      password: { kind: "vault", entryId: "a" },
    });
  });

  it("fills the form and waits when the entry has no password", async () => {
    const onConnect = vi.fn();
    render(<ConnectDialog vault={vaultApi()} onConnect={onConnect} disabled={false} />);

    await userEvent.click(screen.getByRole("button", { name: /^half:/i }));

    expect(onConnect).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^host$/i)).toHaveValue("10.0.0.5");
    expect(screen.getByLabelText(/^username$/i)).toHaveValue("deploy");
    expect(screen.getByLabelText(/^password$/i)).toHaveFocus();
  });

  it("focuses the username when the entry has neither", async () => {
    render(<ConnectDialog vault={vaultApi()} onConnect={vi.fn()} disabled={false} />);

    await userEvent.click(screen.getByRole("button", { name: /^bare:/i }));

    expect(screen.getByLabelText(/^username$/i)).toHaveFocus();
  });

  it("no longer offers the remember host switch", () => {
    render(<ConnectDialog vault={vaultApi()} onConnect={vi.fn()} disabled={false} />);

    expect(screen.queryByText(/remember this host/i)).not.toBeInTheDocument();
  });

  // The old plaintext key is superseded by the vault and must not survive.
  it("clears any lastHost left by an earlier version", () => {
    localStorage.setItem("lastHost", JSON.stringify({ host: "10.0.0.1", port: 22 }));
    localStorage.setItem("rememberLastHost", "true");

    render(<ConnectDialog vault={vaultApi()} onConnect={vi.fn()} disabled={false} />);

    expect(localStorage.getItem("lastHost")).toBeNull();
    expect(localStorage.getItem("rememberLastHost")).toBeNull();
  });

  it("pre-fills the form from a migrated lastHost", () => {
    localStorage.setItem("lastHost", JSON.stringify({ host: "10.0.0.1", port: 2222 }));
    localStorage.setItem("rememberLastHost", "true");

    render(<ConnectDialog vault={vaultApi()} onConnect={vi.fn()} disabled={false} />);

    expect(screen.getByLabelText(/^host$/i)).toHaveValue("10.0.0.1");
    expect(screen.getByLabelText(/^port$/i)).toHaveValue(2222);
  });

  it("does not migrate a lastHost when remembering was disabled", () => {
    localStorage.setItem("lastHost", JSON.stringify({ host: "10.0.0.1", port: 2222 }));
    localStorage.setItem("rememberLastHost", "false");

    render(<ConnectDialog vault={vaultApi()} onConnect={vi.fn()} disabled={false} />);

    expect(screen.getByLabelText(/^host$/i)).toHaveValue("");
    expect(localStorage.getItem("lastHost")).toBeNull();
    expect(localStorage.getItem("rememberLastHost")).toBeNull();
  });

  it("does not show a privacy note when nothing stores a password", () => {
    render(
      <ConnectDialog
        vault={vaultApi({ entries: [entries[1]!] })}
        onConnect={vi.fn()}
        disabled={false}
      />,
    );

    expect(screen.queryByText(/private by design/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/stays in memory/i)).not.toBeInTheDocument();
  });

  it("says a password is stored once an entry stores one", () => {
    render(<ConnectDialog vault={vaultApi()} onConnect={vi.fn()} disabled={false} />);

    expect(screen.getByText(/encrypted in this browser/i)).toBeInTheDocument();
    expect(screen.queryByText(/private by design/i)).not.toBeInTheDocument();
  });

  it("keeps locked-vault copy short and does not expose entries", () => {
    render(
      <ConnectDialog
        vault={vaultApi({ status: "locked", entries: [] })}
        onConnect={vi.fn()}
        disabled={false}
      />,
    );

    expect(screen.getByText(/enter your master password to view them/i)).toBeInTheDocument();
    expect(screen.queryByText(/stays in memory for this connection only/i)).not.toBeInTheDocument();
  });

  it("explains when browser storage is unavailable", () => {
    render(
      <ConnectDialog
        vault={vaultApi({ status: "unavailable", entries: [] })}
        onConnect={vi.fn()}
        disabled={false}
      />,
    );

    expect(screen.getByText(/browser storage is unavailable on this device/i)).toBeInTheDocument();
  });
});
