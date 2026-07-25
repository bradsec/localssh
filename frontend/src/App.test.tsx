import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App.js";
import { APP_VERSION } from "./appVersion.js";
import { DEFAULT_FONT_FAMILY } from "./terminalFonts.js";
import { DEFAULT_THEME_NAME } from "./terminalThemes.js";
import * as engine from "./ssh/engine.js";

vi.mock("./ssh/engine.js", async () => {
  const actual = await vi.importActual<typeof engine>("./ssh/engine.js");
  return { ...actual, connectSession: vi.fn() };
});

const terminalReset = vi.fn();
const terminalFocus = vi.fn();
const terminalBlur = vi.fn();
let terminalActive = false;
// The real terminal reports focus from the textarea's own events; the mock lets a
// test drive that callback to stand in for the browser moving focus.
let reportTerminalFocus: ((focused: boolean) => void) | undefined;

vi.mock("./components/Terminal.js", () => ({
  Terminal: ({
    onResize,
    onReady,
    onFocusChange,
    active,
  }: {
    onResize?: (cols: number, rows: number) => void;
    onReady?: (controls: {
      write: (data: Uint8Array) => void;
      reset: () => void;
      focus: () => void;
      blur: () => void;
    }) => void;
    onFocusChange?: (focused: boolean) => void;
    active: boolean;
  }) => {
    terminalActive = active;
    reportTerminalFocus = onFocusChange;
    onResize?.(48, 20);
    onReady?.({
      write: vi.fn(),
      reset: terminalReset,
      focus: terminalFocus,
      blur: terminalBlur,
    });
    return <div aria-label="SSH terminal emulator" />;
  },
}));

describe("App", () => {
  beforeEach(() => {
    vi.mocked(engine.connectSession).mockReset();
    terminalReset.mockClear();
    terminalFocus.mockClear();
    terminalBlur.mockClear();
    terminalActive = false;
    reportTerminalFocus = undefined;
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

  // On a phone the terminal is the only place to type, and nothing else on the
  // page can give it focus once the connect form is gone.
  it("focuses and blurs the terminal from the keyboard button", async () => {
    const handle: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    vi.mocked(engine.connectSession).mockResolvedValueOnce(handle);

    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^host$/i), "10.0.0.11");
    await user.type(screen.getByLabelText(/^username$/i), "admin");
    await user.type(screen.getByLabelText(/^password$/i), "secret");
    await user.click(screen.getByRole("button", { name: /^connect$/i }));

    const button = await screen.findByRole("button", { name: /^keyboard$/i });
    terminalFocus.mockClear();
    await user.click(button);
    expect(terminalFocus).toHaveBeenCalled();

    act(() => reportTerminalFocus?.(true));
    const hide = screen.getByRole("button", { name: /hide keyboard/i });
    expect(hide).toHaveAttribute("aria-pressed", "true");

    await user.click(hide);
    expect(terminalBlur).toHaveBeenCalled();
  });

  // The shell follows the visual viewport only during a session. Doing it while
  // the connect form is up leaves empty canvas below the shell, and the browser
  // pans into it when it lifts a focused field above the keyboard.
  it("takes its height from the visual viewport only while connected", async () => {
    const handle: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    vi.mocked(engine.connectSession).mockResolvedValueOnce(handle);

    render(<App />);
    expect(document.querySelector(".app-shell")).not.toHaveClass("app-shell--session");

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^host$/i), "10.0.0.12");
    await user.type(screen.getByLabelText(/^username$/i), "admin");
    await user.type(screen.getByLabelText(/^password$/i), "secret");
    await user.click(screen.getByRole("button", { name: /^connect$/i }));

    await waitFor(() =>
      expect(document.querySelector(".app-shell")).toHaveClass("app-shell--session"),
    );

    await user.click(screen.getByRole("button", { name: /disconnect/i }));
    expect(document.querySelector(".app-shell")).not.toHaveClass("app-shell--session");
  });

  // Which build someone is running is the first question when reporting a bug,
  // and the connect panel is the one screen every user sees.
  it("shows the running version on the connect panel", () => {
    render(<App />);
    expect(screen.getByText(`localssh ${APP_VERSION}`)).toBeInTheDocument();
  });

  it("hides the keyboard button while no session is connected", () => {
    render(<App />);
    expect(screen.queryByRole("button", { name: /keyboard/i })).not.toBeInTheDocument();
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
    await user.selectOptions(screen.getByLabelText(/font size/i), "18");

    expect(JSON.parse(localStorage.getItem("terminalSettings") ?? "{}")).toMatchObject({
      fontFamily: '"JetBrains Mono", monospace',
      themeName: "Nord",
      fontSize: 18,
    });

    unmount();
    render(<App />);
    expect(screen.getByLabelText(/font family/i)).toHaveValue('"JetBrains Mono", monospace');
    expect(screen.getByLabelText(/color scheme/i)).toHaveValue("Nord");
    expect(screen.getByLabelText(/font size/i)).toHaveValue("18");
  });

  it("ignores invalid persisted terminal settings", () => {
    localStorage.setItem("terminalSettings", JSON.stringify({
      fontSize: 200,
      fontFamily: "url(evil)",
      themeName: "Missing",
    }));

    render(<App />);

    expect(screen.getByLabelText(/font size/i)).toHaveValue("14");
    expect(screen.getByLabelText(/font family/i)).toHaveValue(DEFAULT_FONT_FAMILY);
    expect(screen.getByLabelText(/color scheme/i)).toHaveValue(DEFAULT_THEME_NAME);
  });
});
