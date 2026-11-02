import { useState } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsDialog } from "./SettingsDialog.js";
import {
  loadTerminalSettings,
  saveTerminalSettings,
  type TerminalSettings,
} from "../storage/settingsStore.js";
import { HelpProvider } from "./Help.js";
import type { SavedEntry, TerminalPrefs } from "../vault/vaultEngine.js";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function Harness({
  save = vi.fn(() => ({ ok: true })),
  activeTarget,
  touchPointer = false,
  keyBarCapacity,
  savedEntry,
  vaultUnlocked = false,
  saveHost = vi.fn(async () => true),
}: {
  save?: (value: TerminalSettings) => { ok: boolean };
  activeTarget?: string;
  touchPointer?: boolean;
  keyBarCapacity?: number;
  savedEntry?: SavedEntry;
  vaultUnlocked?: boolean;
  saveHost?: (terminal: TerminalPrefs | null) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(loadTerminalSettings);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Settings
      </button>
      <SettingsDialog
        open={open}
        onClose={() => setOpen(false)}
        value={value}
        onChange={(next) => {
          setValue(next);
          return save(next);
        }}
        activeTarget={activeTarget ?? "tester@host"}
        hasOpenTerminals={!!activeTarget}
        relayWsUrl="ws://relay.test/relay"
        touchPointer={touchPointer}
        keyBarCapacity={keyBarCapacity}
        savedEntry={savedEntry}
        vaultUnlocked={vaultUnlocked}
        onSaveHost={saveHost}
        returnFocusTo={() => screen.getByRole("button", { name: "Settings" })}
      />
    </>
  );
}

describe("SettingsDialog", () => {
  it.each([
    [undefined, false, "To give a host its own terminal settings, save it in Saved hosts."],
    [
      { id: "a", nickname: "web", host: "web.test", port: 22, hasPassword: true },
      false,
      "Unlock saved hosts to use settings for this host.",
    ],
    [{ id: "a", nickname: "web", host: "web.test", port: 22, hasPassword: true }, true, null],
  ] as const)("shows scope for host state %#", async (savedEntry, vaultUnlocked, hint) => {
    const user = userEvent.setup();
    render(<Harness savedEntry={savedEntry} vaultUnlocked={vaultUnlocked} />);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByLabelText("Apply to")).toHaveValue("all");
    expect((screen.getByLabelText("Apply to") as HTMLSelectElement).disabled).toBe(
      !savedEntry || !vaultUnlocked,
    );
    if (hint) expect(screen.getByText(hint)).toBeInTheDocument();
  });

  it("creates, edits, and removes a host override", async () => {
    const user = userEvent.setup();
    const saveHost = vi.fn(async (_terminal: TerminalPrefs | null) => true);
    const savedEntry: SavedEntry = {
      id: "a",
      nickname: "web",
      host: "web.test",
      port: 22,
      hasPassword: true,
    };
    const { rerender } = render(
      <Harness savedEntry={savedEntry} vaultUnlocked saveHost={saveHost} />,
    );
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.selectOptions(screen.getByLabelText("Apply to"), "host");
    await waitFor(() =>
      expect(saveHost).toHaveBeenCalledWith(
        expect.objectContaining({ fontSize: 14, lineHeight: 1.15 }),
      ),
    );
    savedEntry.terminal = saveHost.mock.calls[0]![0]!;
    rerender(<Harness savedEntry={{ ...savedEntry }} vaultUnlocked saveHost={saveHost} />);
    expect(screen.getByLabelText("Apply to")).toHaveValue("host");
    expect(screen.getByText("Changes here apply only to web.")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Font size"), "18");
    await waitFor(() =>
      expect(saveHost).toHaveBeenLastCalledWith(expect.objectContaining({ fontSize: 18 })),
    );
    await user.click(screen.getByRole("button", { name: "Use all-hosts settings for this host" }));
    await waitFor(() => expect(saveHost).toHaveBeenLastCalledWith(null));
    expect(screen.getByLabelText("Apply to")).toHaveValue("all");
    expect(screen.getByText("This host now uses the settings for all hosts.")).toBeInTheDocument();
  });

  it("keeps the latest scope when creating a host override finishes later", async () => {
    let finishSave: (ok: boolean) => void = () => {};
    const saveHost = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishSave = resolve;
        }),
    );
    const user = userEvent.setup();
    render(
      <Harness
        savedEntry={{ id: "a", nickname: "web", host: "web.test", port: 22, hasPassword: true }}
        vaultUnlocked
        saveHost={saveHost}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.selectOptions(screen.getByLabelText("Apply to"), "host");
    await user.selectOptions(screen.getByLabelText("Apply to"), "all");
    await act(async () => finishSave(true));
    expect(saveHost).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Apply to")).toHaveValue("all");
  });

  it("opens on an existing host override and keeps it when vault saving fails", async () => {
    const user = userEvent.setup();
    const saveHost = vi.fn(async (_terminal: TerminalPrefs | null) => false);
    render(
      <Harness
        savedEntry={{
          id: "a",
          nickname: "web",
          host: "web.test",
          port: 22,
          hasPassword: true,
          terminal: {
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 20,
            lineHeight: 1.5,
            themeName: "Nord",
          },
        }}
        vaultUnlocked
        saveHost={saveHost}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByLabelText("Apply to")).toHaveValue("host");
    expect(screen.getByText("This host uses its own terminal settings.")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Font size"), "21");
    await waitFor(() =>
      expect(screen.getByText("Could not save settings for this host.")).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Font size")).toHaveValue("20");
    expect(saveHost).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 21 }));
  });

  it("waits for a host appearance save before allowing another selection", async () => {
    let finishSave: (ok: boolean) => void = () => {};
    const saveHost = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishSave = resolve;
        }),
    );
    const user = userEvent.setup();
    render(
      <Harness
        savedEntry={{
          id: "a",
          nickname: "web",
          host: "web.test",
          port: 22,
          hasPassword: true,
          terminal: {
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 20,
            lineHeight: 1.5,
            themeName: "Nord",
          },
        }}
        vaultUnlocked
        saveHost={saveHost}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.selectOptions(screen.getByLabelText("Font size"), "21");
    expect(screen.getByLabelText("Line height")).toBeDisabled();
    expect(saveHost).toHaveBeenCalledOnce();
    await act(async () => finishSave(true));
    expect(screen.getByLabelText("Line height")).toBeEnabled();
    await user.selectOptions(screen.getByLabelText("Line height"), "1.55");
    expect(saveHost).toHaveBeenLastCalledWith(
      expect.objectContaining({ fontSize: 21, lineHeight: 1.55 }),
    );
    await act(async () => finishSave(true));
  });

  it("waits for a host appearance save before allowing scope or reset", async () => {
    let finishSave: (ok: boolean) => void = () => {};
    const saveHost = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishSave = resolve;
        }),
    );
    const user = userEvent.setup();
    render(
      <Harness
        savedEntry={{
          id: "a",
          nickname: "web",
          host: "web.test",
          port: 22,
          hasPassword: true,
          terminal: {
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 20,
            lineHeight: 1.5,
            themeName: "Nord",
          },
        }}
        vaultUnlocked
        saveHost={saveHost}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.selectOptions(screen.getByLabelText("Font size"), "21");
    const reset = screen.getByRole("button", { name: "Use all-hosts settings for this host" });
    expect(screen.getByLabelText("Apply to")).toBeDisabled();
    expect(reset).toBeDisabled();
    await user.click(reset);
    expect(saveHost).toHaveBeenCalledOnce();
    await act(async () => finishSave(true));
    expect(screen.getByLabelText("Apply to")).toBeEnabled();
    expect(reset).toBeEnabled();
    await user.click(reset);
    expect(saveHost).toHaveBeenLastCalledWith(null);
    await act(async () => finishSave(true));
  });

  it("opens, previews and applies each terminal field, then returns focus", async () => {
    const save = vi.fn(() => ({ ok: true }));
    const user = userEvent.setup();
    render(<Harness save={save} />);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(dialog.querySelector("h2")).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(screen.getByLabelText("Keep session alive in background")).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    await user.selectOptions(screen.getByLabelText("Font family"), '"JetBrains Mono", monospace');
    await user.selectOptions(screen.getByLabelText("Font size"), "18");
    await user.selectOptions(screen.getByLabelText("Line height"), "1.50");
    await user.selectOptions(screen.getByLabelText("Color scheme"), "Nord");
    expect(save).toHaveBeenCalledTimes(4);
    expect(screen.getByText("Saved on this device.")).toBeInTheDocument();
    expect(dialog.querySelector('[aria-hidden="true"]')).toHaveTextContent("tester@host");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Settings" })).toHaveFocus());
  });

  it("reports a storage failure while retaining the changed value", async () => {
    const user = userEvent.setup();
    render(<Harness save={() => ({ ok: false })} />);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.selectOptions(screen.getByLabelText("Line height"), "1.50");
    expect(screen.getByLabelText("Line height")).toHaveValue("1.50");
    expect(
      screen.getByText(
        "Could not save on this device. This setting lasts until you close the page.",
      ),
    ).toBeInTheDocument();
  });

  it.each([
    ["loading", null, "Checking this server's limit..."],
    ["within", { resume: true, maxGraceMs: 600000 }, "This server allows up to 10 min."],
    ["unlimited", { resume: true, maxGraceMs: null }, "This server sets no limit."],
    [
      "capped",
      { resume: true, maxGraceMs: 60000 },
      "This server limits this to 1 min. Your terminals stay open for 1 min.",
    ],
    [
      "unsupported",
      { resume: false, maxGraceMs: 0 },
      "This server does not keep sessions in the background. Terminals close when the connection drops.",
    ],
    ["unknown", "unknown", "Could not check this server's limit. It applies when you connect."],
  ] as const)("shows %s capability state", async (_state, capability, expected) => {
    const fetchMock = vi.fn();
    if (capability === null) fetchMock.mockImplementation(() => new Promise(() => {}));
    if (capability !== null) {
      fetchMock.mockResolvedValue(
        capability === "unknown"
          ? { ok: false }
          : {
              ok: true,
              json: async () => capability,
            },
      );
    }
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByLabelText("Keep session alive in background")).toHaveValue("120");
    if (capability === null) expect(screen.getByText(expected)).toBeInTheDocument();
    else await waitFor(() => expect(screen.getByText(expected)).toBeInTheDocument());
  });

  it("keeps the user's choice under a cap, shows Off, and opens background Help", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ resume: true, maxGraceMs: 60000 }),
      }),
    );
    const user = userEvent.setup();
    render(
      <HelpProvider>
        <Harness activeTarget="tester@host" save={saveTerminalSettings} />
      </HelpProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const select = screen.getByLabelText("Keep session alive in background");
    await user.selectOptions(select, "3600");
    expect(select).toHaveValue("3600");
    expect(loadTerminalSettings().keepAlive).toBe(3600);
    expect(
      screen.getByText("This server limits this to 1 min. Your terminals stay open for 1 min."),
    ).toBeInTheDocument();
    await user.selectOptions(select, "until-disconnect");
    expect(
      screen.getByText("This server limits this to 1 min. Your terminals stay open for 1 min."),
    ).toBeInTheDocument();
    await user.selectOptions(select, "off");
    expect(screen.getByText("Terminals close when the connection drops.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Applies to terminals you open next. Open terminals keep the time they connected with.",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "About background sessions" }));
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Help with localssh" })).toBeInTheDocument(),
    );
  });

  it("shows no Key bar section on a fine pointer", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.queryByRole("button", { name: "Edit key bar" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Key bar" })).toBeNull();
  });

  it("edits the key bar on a coarse pointer, persists it and returns to Settings", async () => {
    const user = userEvent.setup();
    render(<Harness touchPointer save={saveTerminalSettings} keyBarCapacity={3} />);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "Key bar" })).toBeInTheDocument();
    expect(
      screen.getByText("Choose which keys show above the keyboard and in what order."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit key bar" }));
    const dialog = screen.getByRole("dialog", { name: "Key bar" });
    expect(dialog).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Move ctrl down" }));
    expect(loadTerminalSettings().keyBarKeys.slice(0, 2)).toEqual(["esc", "ctrl"]);
    await user.click(within(dialog).getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit key bar" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Edit key bar" }));
    await user.click(screen.getByRole("button", { name: "Reset key bar" }));
    expect(loadTerminalSettings().keyBarKeys[0]).toBe("ctrl");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Settings" })).toHaveFocus());
  });
});
