import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App.js";
import { DEFAULT_FONT_FAMILY } from "./terminalFonts.js";
import { DEFAULT_THEME_NAME } from "./terminalThemes.js";
import * as engine from "./ssh/engine.js";

vi.mock("./ssh/engine.js", async () => {
  const actual = await vi.importActual<typeof engine>("./ssh/engine.js");
  return { ...actual, connectSession: vi.fn() };
});

const terminalReset = vi.fn();
const terminalFocus = vi.fn();
let terminalActive = false;

vi.mock("./components/Terminal.js", () => ({
  Terminal: ({
    onResize,
    onReady,
    active,
  }: {
    onResize?: (cols: number, rows: number) => void;
    onReady?: (controls: {
      write: (data: Uint8Array) => void;
      reset: () => void;
      focus: () => void;
    }) => void;
    active: boolean;
  }) => {
    terminalActive = active;
    onResize?.(48, 20);
    onReady?.({ write: vi.fn(), reset: terminalReset, focus: terminalFocus });
    return <div aria-label="SSH terminal emulator" />;
  },
}));

describe("App", () => {
  beforeEach(() => {
    vi.mocked(engine.connectSession).mockReset();
    terminalReset.mockClear();
    terminalFocus.mockClear();
    terminalActive = false;
    localStorage.clear();
  });

  it("renders the connect form", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: /connect/i })).toBeInTheDocument();
    expect(terminalActive).toBe(false);
  });

  it("shows the host-key prompt when the engine rejects an unknown host", async () => {
    vi.mocked(engine.connectSession).mockRejectedValueOnce(
      new engine.HostKeyRejectedError("10.0.0.5:22", "SHA256:deadbeef"),
    );

    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^host$/i), "10.0.0.5");
    await user.type(screen.getByLabelText(/^username$/i), "admin");
    await user.type(screen.getByLabelText(/^password$/i), "secret");
    await user.click(screen.getByRole("button", { name: /connect/i }));

    expect(await screen.findByText(/SHA256:deadbeef/)).toBeInTheDocument();
  });

  it("stores an accepted host key and retries the connection", async () => {
    const handle: engine.SshHandle = {
      write: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
    };
    vi.mocked(engine.connectSession)
      .mockRejectedValueOnce(
        new engine.HostKeyRejectedError("10.0.0.6:22", "SHA256:trusted"),
      )
      .mockResolvedValueOnce(handle);

    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^host$/i), "10.0.0.6");
    await user.type(screen.getByLabelText(/^username$/i), "admin");
    await user.type(screen.getByLabelText(/^password$/i), "secret");
    await user.click(screen.getByRole("button", { name: /^connect$/i }));
    await user.click(await screen.findByRole("button", { name: /trust and connect/i }));

    await waitFor(() => expect(engine.connectSession).toHaveBeenCalledTimes(2));
    const retry = vi.mocked(engine.connectSession).mock.calls[1]?.[0];
    expect(retry?.isTrustedFingerprint("SHA256:trusted")).toBe(true);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("applies the fitted terminal dimensions to a new SSH session", async () => {
    const handle: engine.SshHandle = {
      write: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
    };
    vi.mocked(engine.connectSession).mockResolvedValueOnce(handle);

    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^host$/i), "10.0.0.8");
    await user.type(screen.getByLabelText(/^username$/i), "admin");
    await user.type(screen.getByLabelText(/^password$/i), "secret");
    await user.click(screen.getByRole("button", { name: /^connect$/i }));

    await waitFor(() => expect(handle.resize).toHaveBeenCalledWith(48, 20));
    await waitFor(() => expect(terminalFocus).toHaveBeenCalled());
    expect(terminalActive).toBe(true);
  });

  it("clears the terminal when the session is disconnected", async () => {
    const handle: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    vi.mocked(engine.connectSession).mockResolvedValueOnce(handle);

    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^host$/i), "10.0.0.9");
    await user.type(screen.getByLabelText(/^username$/i), "admin");
    await user.type(screen.getByLabelText(/^password$/i), "secret");
    await user.click(screen.getByRole("button", { name: /^connect$/i }));

    await user.click(await screen.findByRole("button", { name: /disconnect/i }));

    expect(handle.close).toHaveBeenCalled();
    // A stale session must not stay legible behind the connect form.
    expect(terminalReset).toHaveBeenCalled();
  });

  it("remembers only the host and port when the toggle is enabled", async () => {
    const { unmount } = render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/^host$/i), "ssh.example.com");
    await user.clear(screen.getByLabelText(/^port$/i));
    await user.type(screen.getByLabelText(/^port$/i), "2222");
    await user.click(screen.getByLabelText(/remember this host/i));

    const stored = JSON.parse(localStorage.getItem("lastHost") ?? "{}");
    expect(Object.keys(stored).sort()).toEqual(["host", "port"]);

    unmount();
    render(<App />);
    expect(screen.getByLabelText(/^host$/i)).toHaveValue("ssh.example.com");
    expect(screen.getByLabelText(/^port$/i)).toHaveValue(2222);
    expect(screen.getByLabelText(/^username$/i)).toHaveValue("");
    expect(screen.getByLabelText(/^password$/i)).toHaveValue("");
  });

  it("does not remember the host while the toggle is off", async () => {
    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/^host$/i), "ssh.example.com");
    await user.type(screen.getByLabelText(/^username$/i), "admin");
    await user.type(screen.getByLabelText(/^password$/i), "secret");
    await user.click(screen.getByRole("button", { name: /^connect$/i }));

    expect(localStorage.getItem("lastHost")).toBeNull();
  });

  // Each option is changed away from its default, so restoring the default
  // instead of the stored value would fail this.
  it("persists terminal appearance settings", async () => {
    const { unmount } = render(<App />);
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText(/font family/i), '"JetBrains Mono", monospace');
    await user.selectOptions(screen.getByLabelText(/color scheme/i), "Nord");
    fireEvent.change(screen.getByLabelText(/font size/i), { target: { value: "18" } });

    expect(JSON.parse(localStorage.getItem("terminalSettings") ?? "{}")).toMatchObject({
      fontFamily: '"JetBrains Mono", monospace',
      themeName: "Nord",
      fontSize: 18,
    });

    unmount();
    render(<App />);
    expect(screen.getByLabelText(/font family/i)).toHaveValue('"JetBrains Mono", monospace');
    expect(screen.getByLabelText(/color scheme/i)).toHaveValue("Nord");
    expect(screen.getByLabelText(/font size/i)).toHaveValue(18);
  });

  it("ignores invalid persisted terminal settings", () => {
    localStorage.setItem("terminalSettings", JSON.stringify({
      fontSize: 200,
      fontFamily: "url(evil)",
      themeName: "Missing",
    }));

    render(<App />);

    expect(screen.getByLabelText(/font size/i)).toHaveValue(14);
    expect(screen.getByLabelText(/font family/i)).toHaveValue(DEFAULT_FONT_FAMILY);
    expect(screen.getByLabelText(/color scheme/i)).toHaveValue(DEFAULT_THEME_NAME);
  });
});
