import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { App } from "./App.js";
import { APP_VERSION } from "./appVersion.js";
import { DEFAULT_FONT_FAMILY } from "./terminalFonts.js";
import { DEFAULT_THEME_NAME } from "./terminalThemes.js";
import * as engine from "./ssh/engine.js";
import * as knownHostsStore from "./storage/knownHostsStore.js";

vi.mock("./ssh/engine.js", async () => {
  const actual = await vi.importActual<typeof engine>("./ssh/engine.js");
  return { ...actual, connectSession: vi.fn() };
});
vi.mock("./storage/knownHostsStore.js", async () => {
  const actual = await vi.importActual<typeof knownHostsStore>("./storage/knownHostsStore.js");
  return { ...actual, loadKnownHosts: vi.fn(), trustHostKey: vi.fn() };
});

const terminalReset = vi.fn();
const terminalFocus = vi.fn();
const terminalBlur = vi.fn();
let terminalActive = false;
// Handles the real terminal hands out, so a test can type into the session and
// report the focus a phone's keyboard follows.
let terminalInput: ((data: string) => void) | undefined;
let terminalFocusChange: ((focused: boolean) => void) | undefined;
let terminalSelectionChange: ((hasSelection: boolean) => void) | undefined;
const terminalPaste = vi.fn();
const terminalWrites: ReturnType<typeof vi.fn>[] = [];
let terminalSelectionText = "";

vi.mock("./components/Terminal.js", () => ({
  Terminal: ({
    onResize,
    onReady,
    onInput,
    onFocusChange,
    onSelectionChange,
    active,
  }: {
    onResize?: (cols: number, rows: number) => void;
    onReady?: (controls: {
      write: (data: Uint8Array) => void;
      reset: () => void;
      focus: () => void;
      blur: () => void;
      applicationCursorMode: () => boolean;
      getSelection: () => string;
      paste: (text: string) => void;
    }) => void;
    onInput?: (data: string) => void;
    onFocusChange?: (focused: boolean) => void;
    onSelectionChange?: (hasSelection: boolean) => void;
    active: boolean;
  }) => {
    const write = useRef(vi.fn());
    if (!terminalWrites.includes(write.current)) terminalWrites.push(write.current);
    terminalActive = active;
    terminalInput = onInput;
    terminalFocusChange = onFocusChange;
    terminalSelectionChange = onSelectionChange;
    onResize?.(48, 20);
    onReady?.({
      write: write.current,
      reset: terminalReset,
      focus: terminalFocus,
      blur: terminalBlur,
      applicationCursorMode: () => false,
      getSelection: () => terminalSelectionText,
      paste: terminalPaste,
    });
    return <div aria-label="SSH terminal emulator" />;
  },
}));

/** Reports the pointer the media query in App asks about. */
function usePointer(kind: "coarse" | "fine") {
  window.matchMedia = ((query: string) => ({
    matches: query.includes(kind),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

/** A screen below the desktop breakpoint, where the session toolbar folds into Actions. */
function useNarrowScreen() {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("max-width: 1023px"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

/** Fills in the connect form and waits for the session to be up. */
async function submitConnect(user: ReturnType<typeof userEvent.setup>, host: string) {
  await user.type(screen.getByLabelText(/^host$/i), host);
  await user.type(screen.getByLabelText(/^username$/i), "admin");
  await user.type(screen.getByLabelText(/^password$/i), "secret");
  await user.click(screen.getByRole("button", { name: /^connect to server$/i }));
}

async function connect(user: ReturnType<typeof userEvent.setup>, host: string) {
  await submitConnect(user, host);
  await screen.findByRole("button", { name: /disconnect/i });
}

function sentBytes(handle: engine.SshHandle): string {
  const decoder = new TextDecoder();
  return vi
    .mocked(handle.write)
    .mock.calls.map(([chunk]) => decoder.decode(chunk))
    .join("");
}

describe("App", () => {
  beforeEach(() => {
    vi.mocked(engine.connectSession).mockReset();
    vi.mocked(knownHostsStore.loadKnownHosts).mockResolvedValue(new Map());
    terminalReset.mockClear();
    terminalFocus.mockClear();
    terminalBlur.mockClear();
    terminalActive = false;
    terminalInput = undefined;
    terminalFocusChange = undefined;
    terminalSelectionChange = undefined;
    terminalPaste.mockClear();
    terminalWrites.length = 0;
    terminalSelectionText = "";
    usePointer("fine");
    localStorage.clear();
  });

  it("keeps another SSH session open when a terminal tab closes", async () => {
    const first: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    const second: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    vi.mocked(engine.connectSession).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    render(<App />);
    const user = userEvent.setup();

    await connect(user, "first.example");
    await user.click(screen.getByRole("button", { name: "New terminal" }));
    await connect(user, "second.example");

    expect(first.close).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: /first.example, connected/i })).toBeVisible();
    expect(screen.getByRole("tab", { name: /second.example, connected/i })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Close second.example terminal" }));
    expect(second.close).toHaveBeenCalledOnce();
    expect(first.close).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: /first.example, connected/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("keeps each tab's file panel on its own SSH handle", async () => {
    const firstFiles: engine.SftpHandle = {
      list: vi.fn().mockResolvedValue({
        path: "/home/tester",
        entries: [{ name: "first.txt", kind: "file", isLink: false, size: 1 }],
      }),
      upload: vi.fn(),
      download: vi.fn(),
      cancel: vi.fn(),
      close: vi.fn(),
    };
    const secondFiles: engine.SftpHandle = {
      list: vi.fn().mockResolvedValue({
        path: "/home/tester",
        entries: [{ name: "second.txt", kind: "file", isLink: false, size: 2 }],
      }),
      upload: vi.fn(),
      download: vi.fn(),
      cancel: vi.fn(),
      close: vi.fn(),
    };
    const first: engine.SshHandle = {
      write: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
      openFiles: vi.fn().mockResolvedValue(firstFiles),
    };
    const second: engine.SshHandle = {
      write: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
      openFiles: vi.fn().mockResolvedValue(secondFiles),
    };
    vi.mocked(engine.connectSession).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    render(<App />);
    const user = userEvent.setup();
    await connect(user, "first.example");
    await user.click(screen.getByRole("button", { name: "Files" }));
    await screen.findByText("first.txt");
    await user.click(screen.getByRole("button", { name: "New terminal" }));
    await connect(user, "second.example");
    await user.click(screen.getByRole("button", { name: "Files" }));
    await screen.findByText("second.txt");
    expect(screen.getByText("first.txt")).not.toBeVisible();
    await user.click(screen.getByRole("tab", { name: /first.example, connected/i }));
    expect(screen.getByText("first.txt")).toBeVisible();
    expect(screen.getByText("second.txt")).not.toBeVisible();
    expect(first.openFiles).toHaveBeenCalledOnce();
    expect(second.openFiles).toHaveBeenCalledOnce();
  });

  it("routes touch keys and keyboard tab switching to the selected SSH session", async () => {
    usePointer("coarse");
    const first: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    const second: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    vi.mocked(engine.connectSession).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    render(<App />);
    const user = userEvent.setup();
    await connect(user, "first.example");
    await user.click(screen.getByRole("button", { name: "New terminal" }));
    await connect(user, "second.example");

    await user.click(
      within(screen.getByRole("toolbar", { name: "Terminal keys" })).getByRole("button", {
        name: "Escape",
      }),
    );
    expect(sentBytes(second)).toBe("\u001b");
    expect(sentBytes(first)).toBe("");

    await user.keyboard("{Control>}{Alt>}{Shift>}{ArrowLeft}{/Shift}{/Alt}{/Control}");
    expect(screen.getByRole("tab", { name: /first.example, connected/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.click(
      within(screen.getByRole("toolbar", { name: "Terminal keys" })).getByRole("button", {
        name: "Escape",
      }),
    );
    expect(sentBytes(first)).toBe("\u001b");
    expect(sentBytes(second)).toBe("\u001b");
  });

  it("keeps sibling tabs open when one connection drops", async () => {
    const first: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    const second: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    vi.mocked(engine.connectSession).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    render(<App />);
    const user = userEvent.setup();
    await connect(user, "first.example");
    await user.click(screen.getByRole("button", { name: "New terminal" }));
    await connect(user, "second.example");

    const { onClose } = vi.mocked(engine.connectSession).mock.calls[1]![0];
    act(() => onClose("connection lost"));

    expect(screen.getByRole("tab", { name: /second.example, disconnected/i })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("The connection to the server was lost.");
    await user.click(screen.getByRole("tab", { name: /first.example, connected/i }));
    expect(first.close).not.toHaveBeenCalled();
    expect(screen.getByText("Connected", { exact: true })).toBeInTheDocument();
  });

  it("marks a dropped tab without relying on color while another tab is selected", async () => {
    const first: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    const second: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    vi.mocked(engine.connectSession).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    render(<App />);
    const user = userEvent.setup();
    await connect(user, "first.example");
    await user.click(screen.getByRole("button", { name: "New terminal" }));
    await connect(user, "second.example");

    const live = screen.getByRole("tab", { name: /second.example, connected/i });
    expect(within(live).queryByText("Disconnected")).not.toBeInTheDocument();

    const { onClose } = vi.mocked(engine.connectSession).mock.calls[1]![0];
    act(() => onClose("connection lost"));
    await user.click(screen.getByRole("tab", { name: /first.example, connected/i }));

    const dropped = screen.getByRole("tab", { name: /second.example, disconnected/i });
    expect(dropped).toHaveAttribute("aria-selected", "false");
    expect(within(dropped).getByText("Disconnected")).toBeVisible();
    const icon = dropped.querySelector("svg.lucide-unplug");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(
      within(screen.getByRole("tab", { name: /first.example, connected/i })).queryByText(
        "Disconnected",
      ),
    ).not.toBeInTheDocument();
  });

  it("writes background output to its own terminal buffer", async () => {
    const first: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    const second: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    vi.mocked(engine.connectSession).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    render(<App />);
    const user = userEvent.setup();
    await connect(user, "first.example");
    await user.click(screen.getByRole("button", { name: "New terminal" }));
    await connect(user, "second.example");

    const firstData = vi.mocked(engine.connectSession).mock.calls[0]![0].onData;
    const secondData = vi.mocked(engine.connectSession).mock.calls[1]![0].onData;
    act(() => {
      firstData(new Uint8Array([65]));
      secondData(new Uint8Array([66]));
    });

    expect(terminalWrites[1]).toHaveBeenCalledWith(new Uint8Array([65]));
    expect(terminalWrites[2]).toHaveBeenCalledWith(new Uint8Array([66]));
    expect(terminalWrites[1]).not.toHaveBeenCalledWith(new Uint8Array([66]));
  });

  it("leaves the first session open when another connection fails", async () => {
    const first: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    vi.mocked(engine.connectSession)
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce("could not reach the relay: session limit reached");
    render(<App />);
    const user = userEvent.setup();
    await connect(user, "first.example");
    await user.click(screen.getByRole("button", { name: "New terminal" }));
    await submitConnect(user, "second.example");

    expect(await screen.findByRole("alert")).toHaveTextContent("MAX_SESSIONS");
    expect(first.close).not.toHaveBeenCalled();
    await user.click(screen.getByRole("tab", { name: /first.example, connected/i }));
    expect(screen.getByText("Connected", { exact: true })).toBeInTheDocument();
  });

  it("closes every SSH handle when the page unmounts", async () => {
    const first: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    const second: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    vi.mocked(engine.connectSession).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const { unmount } = render(<App />);
    const user = userEvent.setup();
    await connect(user, "first.example");
    await user.click(screen.getByRole("button", { name: "New terminal" }));
    await connect(user, "second.example");

    unmount();
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
  });

  it("lets a user return to an open shell while another host key waits for review", async () => {
    const first: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    vi.mocked(engine.connectSession)
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new engine.HostKeyRejectedError("second.example:22", "SHA256:other"));
    render(<App />);
    const user = userEvent.setup();
    await connect(user, "first.example");
    await user.click(screen.getByRole("button", { name: "New terminal" }));
    await submitConnect(user, "second.example");
    expect(await screen.findByRole("alertdialog", { name: /verify host key/i })).toHaveTextContent(
      "second.example:22",
    );

    await user.click(screen.getByRole("button", { name: "Return to open terminal" }));
    expect(screen.getByRole("tab", { name: /first.example, connected/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(first.close).not.toHaveBeenCalled();
    await user.click(screen.getByRole("tab", { name: /second.example, connecting/i }));
    expect(screen.getByRole("alertdialog", { name: /verify host key/i })).toHaveTextContent(
      "second.example:22",
    );
  });

  it("does not retry a trusted host after its pending tab closes", async () => {
    const first: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    let finishTrust!: () => void;
    vi.mocked(engine.connectSession)
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new engine.HostKeyRejectedError("second.example:22", "SHA256:other"));
    vi.mocked(knownHostsStore.trustHostKey).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishTrust = resolve;
        }),
    );
    render(<App />);
    const user = userEvent.setup();
    await connect(user, "first.example");
    await user.click(screen.getByRole("button", { name: "New terminal" }));
    await user.type(screen.getByLabelText(/^host$/i), "second.example");
    await user.type(screen.getByLabelText(/^username$/i), "admin");
    await user.click(screen.getByLabelText(/^private key$/i));
    await user.type(screen.getByLabelText(/or paste the private key/i), "test-key");
    await user.click(screen.getByRole("button", { name: /^connect to server$/i }));
    await screen.findByRole("alertdialog", { name: "Verify host key" });
    const key = vi.mocked(engine.connectSession).mock.calls[1]![0].password;

    await user.click(screen.getByRole("button", { name: /trust and connect/i }));
    await user.click(screen.getByRole("button", { name: "Return to open terminal" }));
    await user.click(screen.getByRole("button", { name: "Close second.example terminal" }));
    await act(async () => finishTrust());

    expect(engine.connectSession).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("tab", { name: /second.example/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog", { name: "Verify host key" })).not.toBeInTheDocument();
    if (key.kind === "key") {
      expect(Array.from(key.privateKey)).toEqual(Array(8).fill(0));
    }
    expect(first.close).not.toHaveBeenCalled();
  });

  it("shows the pending host-key prompt when a shortcut switches to its tab", async () => {
    const first: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    vi.mocked(engine.connectSession)
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new engine.HostKeyRejectedError("second.example:22", "SHA256:other"));
    render(<App />);
    const user = userEvent.setup();
    await connect(user, "first.example");
    await user.click(screen.getByRole("button", { name: "New terminal" }));
    await submitConnect(user, "second.example");
    await screen.findByRole("alertdialog", { name: "Verify host key" });
    await user.click(screen.getByRole("button", { name: "Return to open terminal" }));

    await user.keyboard("{Control>}{Alt>}{Shift>}{ArrowRight}{/Shift}{/Alt}{/Control}");

    expect(screen.getByRole("alertdialog", { name: "Verify host key" })).toHaveTextContent(
      "second.example:22",
    );
    expect(first.close).not.toHaveBeenCalled();
  });

  it("closes a connection that finishes after its pending tab was removed", async () => {
    const first: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    const late: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    let finish!: (handle: engine.SshHandle) => void;
    vi.mocked(engine.connectSession)
      .mockResolvedValueOnce(first)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    render(<App />);
    const user = userEvent.setup();
    await connect(user, "first.example");
    await user.click(screen.getByRole("button", { name: "New terminal" }));
    await submitConnect(user, "second.example");
    await screen.findByRole("tab", { name: /second.example, connecting/i });

    await user.click(screen.getByRole("button", { name: "Close second.example terminal" }));
    await act(async () => finish(late));
    await waitFor(() => expect(late.close).toHaveBeenCalledOnce());
    expect(first.close).not.toHaveBeenCalled();
  });

  it("closes every SSH handle when the browser page is hidden", async () => {
    const first: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    vi.mocked(engine.connectSession).mockResolvedValueOnce(first);
    render(<App />);
    await connect(userEvent.setup(), "first.example");

    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(first.close).toHaveBeenCalledOnce();
  });

  it("renders the connect form", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: /connect/i })).toBeInTheDocument();
    expect(terminalActive).toBe(false);
  });

  it("returns to an actionable error when known-host storage fails", async () => {
    vi.mocked(knownHostsStore.loadKnownHosts).mockRejectedValueOnce(
      new Error("known-host storage unavailable"),
    );
    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^host$/i), "10.0.0.5");
    await user.type(screen.getByLabelText(/^username$/i), "admin");
    await user.type(screen.getByLabelText(/^password$/i), "secret");
    await user.click(screen.getByRole("button", { name: /^connect to server$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("known-host storage unavailable");
    expect(screen.getByRole("button", { name: /^connect to server$/i })).toBeEnabled();
    expect(engine.connectSession).not.toHaveBeenCalled();
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

  it("wipes a pending private key when host-key trust is cancelled", async () => {
    vi.mocked(engine.connectSession).mockRejectedValueOnce(
      new engine.HostKeyRejectedError("10.0.0.5:22", "SHA256:deadbeef"),
    );
    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^host$/i), "10.0.0.5");
    await user.type(screen.getByLabelText(/^username$/i), "admin");
    await user.click(screen.getByLabelText(/^private key$/i));
    await user.type(screen.getByLabelText(/or paste the private key/i), "test-key");
    await user.click(screen.getByRole("button", { name: /^connect to server$/i }));
    const key = vi.mocked(engine.connectSession).mock.calls[0]?.[0].password;
    expect(key).toMatchObject({ kind: "key" });
    await user.click(await screen.findByRole("button", { name: /^cancel$/i }));
    if (key?.kind === "key") expect(Array.from(key.privateKey)).toEqual(Array(8).fill(0));
  });

  it("wipes a pending key and passphrase when a new connection replaces the host-key prompt", async () => {
    const first: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    const third: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    vi.mocked(engine.connectSession)
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new engine.HostKeyRejectedError("second.example:22", "SHA256:other"))
      .mockResolvedValueOnce(third);
    render(<App />);
    const user = userEvent.setup();
    await connect(user, "first.example");
    await user.click(screen.getByRole("button", { name: "New terminal" }));
    await user.type(screen.getByLabelText(/^host$/i), "second.example");
    await user.type(screen.getByLabelText(/^username$/i), "admin");
    await user.click(screen.getByLabelText(/^private key$/i));
    await user.type(screen.getByLabelText(/or paste the private key/i), "test-key");
    await user.type(screen.getByLabelText(/^key passphrase$/i), "hunter2");
    await user.click(screen.getByRole("button", { name: /^connect to server$/i }));
    await screen.findByRole("alertdialog", { name: "Verify host key" });
    const key = vi.mocked(engine.connectSession).mock.calls[1]?.[0].password;
    expect(key).toMatchObject({ kind: "key" });
    await user.click(screen.getByRole("button", { name: "Return to open terminal" }));
    await user.keyboard("{Control>}{Alt>}{Shift>}{ArrowRight}{/Shift}{/Alt}{/Control}");
    await screen.findByRole("alertdialog", { name: "Verify host key" });

    await user.clear(screen.getByLabelText(/^host$/i));
    await user.clear(screen.getByLabelText(/^username$/i));
    await submitConnect(user, "third.example");
    await waitFor(() => expect(engine.connectSession).toHaveBeenCalledTimes(3));

    if (key?.kind !== "key") throw new Error("expected a key");
    expect(Array.from(key.privateKey)).toEqual(Array(8).fill(0));
    expect(key.passphrase).toBe("");
  });

  it("stores an accepted host key and retries the connection", async () => {
    vi.mocked(knownHostsStore.loadKnownHosts)
      .mockResolvedValueOnce(new Map())
      .mockResolvedValueOnce(new Map([["10.0.0.6:22", "SHA256:trusted"]]));
    const handle: engine.SshHandle = {
      write: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
    };
    vi.mocked(engine.connectSession)
      .mockRejectedValueOnce(new engine.HostKeyRejectedError("10.0.0.6:22", "SHA256:trusted"))
      .mockResolvedValueOnce(handle);

    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^host$/i), "10.0.0.6");
    await user.type(screen.getByLabelText(/^username$/i), "admin");
    await user.type(screen.getByLabelText(/^password$/i), "secret");
    await user.click(screen.getByRole("button", { name: /^connect to server$/i }));
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
    await user.click(screen.getByRole("button", { name: /^connect to server$/i }));

    await waitFor(() => expect(handle.resize).toHaveBeenCalledWith(48, 20));
    await waitFor(() => expect(terminalFocus).toHaveBeenCalled());
    expect(terminalActive).toBe(true);
  });

  it("shows rejected input without dropping the active connection", async () => {
    const handle: engine.SshHandle = {
      write: vi.fn().mockReturnValue("write queue full"),
      resize: vi.fn(),
      close: vi.fn(),
    };
    vi.mocked(engine.connectSession).mockResolvedValueOnce(handle);
    render(<App />);
    const user = userEvent.setup();
    await connect(user, "10.0.0.9");

    act(() => terminalInput?.("paste"));
    expect(screen.getByRole("alert")).toHaveTextContent("write queue full");
    expect(screen.getByRole("alert")).toHaveTextContent(/input was not sent/i);
    expect(screen.getByRole("button", { name: /disconnect/i })).toBeVisible();
    expect(terminalActive).toBe(true);
    expect(handle.close).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /disconnect/i }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clears the terminal when the session is disconnected", async () => {
    const handle: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    vi.mocked(engine.connectSession).mockResolvedValueOnce(handle);

    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^host$/i), "10.0.0.9");
    await user.type(screen.getByLabelText(/^username$/i), "admin");
    await user.type(screen.getByLabelText(/^password$/i), "secret");
    await user.click(screen.getByRole("button", { name: /^connect to server$/i }));

    const disconnect = await screen.findByRole("button", { name: "Disconnect" });
    const icons = disconnect.querySelectorAll("svg");
    expect(icons).toHaveLength(1);
    expect(icons[0]).toHaveAttribute("aria-hidden", "true");

    await user.click(disconnect);

    expect(handle.close).toHaveBeenCalled();
    // A stale session must not stay legible behind the connect form.
    expect(terminalReset).toHaveBeenCalled();
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
    await user.click(screen.getByRole("button", { name: /^connect to server$/i }));

    await waitFor(() =>
      expect(document.querySelector(".app-shell")).toHaveClass("app-shell--session"),
    );

    await user.click(screen.getByRole("button", { name: /disconnect/i }));
    expect(document.querySelector(".app-shell")).not.toHaveClass("app-shell--session");
  });

  // Which build someone is running is the first question when reporting a bug.
  // About is in the toolbar on every screen, so the version lives there rather
  // than as a footer on the connect form.
  it("shows the running version in About", async () => {
    render(<App />);
    expect(screen.queryByText(`Version ${APP_VERSION}`)).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "About" }));
    const about = screen.getByText("Version").closest("dl")!;
    expect(within(about).getByText(APP_VERSION)).toBeVisible();
  });

  // An idle connect form has no connection to report, so it shows no status.
  it("does not label the idle connect view as offline", () => {
    render(<App />);
    expect(screen.queryByText("Offline")).not.toBeInTheDocument();
  });

  it("does not offer plaintext host memory", () => {
    render(<App />);

    expect(screen.queryByText(/remember this host/i)).not.toBeInTheDocument();
  });

  it("removes obsolete plaintext host memory on startup", () => {
    localStorage.setItem("lastHost", JSON.stringify({ host: "ssh.example.com", port: 2222 }));
    localStorage.setItem("rememberLastHost", "true");

    render(<App />);

    expect(screen.getByLabelText(/^host$/i)).toHaveValue("ssh.example.com");
    expect(screen.getByLabelText(/^port$/i)).toHaveValue(2222);
    expect(localStorage.getItem("lastHost")).toBeNull();
    expect(localStorage.getItem("rememberLastHost")).toBeNull();
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

  // The bar stands in for keys the touch device has no other way to send, so it
  // belongs to a running session on such a device whether or not the on-screen
  // keyboard happens to be open.
  // On a narrow screen the session controls do not fit beside the brand and the
  // target, so they sit behind one Actions button instead of overlapping.
  it("folds the session controls into Actions on a narrow screen", async () => {
    useNarrowScreen();
    const handle: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    vi.mocked(engine.connectSession).mockResolvedValueOnce(handle);

    render(<App />);
    const user = userEvent.setup();
    // The connect view keeps its three controls in the toolbar.
    expect(screen.queryByRole("button", { name: "Actions" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Help" })).toBeInTheDocument();

    await submitConnect(user, "10.0.0.30");
    const actions = await screen.findByRole("button", { name: "Actions" });
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("admin@10.0.0.30:22")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
    expect(actions).toHaveAttribute("aria-expanded", "false");

    await user.click(actions);
    expect(actions).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByRole("group", { name: "Actions" });
    for (const name of ["Files", "Disconnect", "Clipboard", "Appearance", "Help", "About"]) {
      expect(within(panel).getByRole("button", { name })).toBeInTheDocument();
    }

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Actions" })).not.toBeInTheDocument();
    expect(actions).toHaveFocus();

    await user.click(actions);
    await user.click(
      within(screen.getByRole("group", { name: "Actions" })).getByRole("button", { name: "Files" }),
    );
    expect(screen.getByRole("region", { name: "Files" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Actions" })).not.toBeInTheDocument();

    await user.click(actions);
    await user.click(
      within(screen.getByRole("group", { name: "Actions" })).getByRole("button", {
        name: "Disconnect",
      }),
    );
    expect(handle.close).toHaveBeenCalled();
  });

  it("shows the key bar for a touch session and takes it away with the session", async () => {
    usePointer("coarse");
    const handle: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    vi.mocked(engine.connectSession).mockResolvedValueOnce(handle);

    render(<App />);
    const user = userEvent.setup();
    expect(screen.queryByRole("toolbar", { name: /terminal keys/i })).not.toBeInTheDocument();

    await connect(user, "10.0.0.20");
    expect(screen.getByRole("toolbar", { name: /terminal keys/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /disconnect/i }));
    expect(screen.queryByRole("toolbar", { name: /terminal keys/i })).not.toBeInTheDocument();
  });

  it("keeps the key bar off a device with a pointer that is not a finger", async () => {
    const handle: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    vi.mocked(engine.connectSession).mockResolvedValueOnce(handle);

    render(<App />);
    await connect(userEvent.setup(), "10.0.0.21");

    expect(screen.queryByRole("toolbar", { name: /terminal keys/i })).not.toBeInTheDocument();
  });

  // Focus is the only handle a page has on the on-screen keyboard, so the
  // toggle is the terminal's focus put under a button.
  it("raises and dismisses the keyboard from the bar", async () => {
    usePointer("coarse");
    const handle: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    vi.mocked(engine.connectSession).mockResolvedValueOnce(handle);

    render(<App />);
    const user = userEvent.setup();
    await connect(user, "10.0.0.26");
    // Connecting focuses the terminal, which is the keyboard coming up.
    act(() => terminalFocusChange?.(true));

    const hideKeyboard = screen.getByRole("button", { name: /hide keyboard/i });
    expect(hideKeyboard).toHaveAttribute("aria-pressed", "true");
    expect(hideKeyboard.querySelector('[data-testid="keyboard-dismiss-cue"]')).not.toBeNull();
    const hiddenStateIcons = hideKeyboard.querySelectorAll("svg");
    expect(hiddenStateIcons).toHaveLength(2);
    expect(hideKeyboard.querySelector("svg.lucide-keyboard")).not.toBeNull();
    expect(hideKeyboard.querySelector("svg.lucide-chevron-down")).not.toBeNull();
    for (const icon of hiddenStateIcons) {
      expect(icon).toHaveAttribute("aria-hidden", "true");
    }
    await user.click(hideKeyboard);
    expect(terminalBlur).toHaveBeenCalled();

    act(() => terminalFocusChange?.(false));
    terminalFocus.mockClear();
    const showKeyboard = screen.getByRole("button", { name: /show keyboard/i });
    expect(showKeyboard).toHaveAttribute("aria-pressed", "false");
    expect(showKeyboard.querySelector('[data-testid="keyboard-dismiss-cue"]')).toBeNull();
    expect(showKeyboard.querySelectorAll("svg")).toHaveLength(1);
    expect(showKeyboard.querySelector("svg.lucide-keyboard")).not.toBeNull();
    await user.click(showKeyboard);
    expect(terminalFocus).toHaveBeenCalled();
  });

  // The point of Enter on the bar: recall a command and run it without ever
  // opening the on-screen keyboard.
  it("recalls and runs a command from the bar alone", async () => {
    usePointer("coarse");
    const handle: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    vi.mocked(engine.connectSession).mockResolvedValueOnce(handle);

    render(<App />);
    const user = userEvent.setup();
    await connect(user, "10.0.0.25");

    await user.click(screen.getByRole("button", { name: /up arrow/i }));
    await user.click(screen.getByRole("button", { name: /^enter$/i }));

    expect(sentBytes(handle)).toBe("\x1b[A\r");
  });

  it("sends a key from the bar to the session", async () => {
    usePointer("coarse");
    const handle: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    vi.mocked(engine.connectSession).mockResolvedValueOnce(handle);

    render(<App />);
    const user = userEvent.setup();
    await connect(user, "10.0.0.22");

    await user.click(screen.getByRole("button", { name: /control c/i }));
    await user.click(screen.getByRole("button", { name: /up arrow/i }));

    expect(sentBytes(handle)).toBe("\x03\x1b[A");
  });

  // The point of the sticky modifier: the letter comes from the system keyboard,
  // which has no Ctrl of its own.
  it("turns the next typed character into a control code after ctrl is tapped", async () => {
    usePointer("coarse");
    const handle: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    vi.mocked(engine.connectSession).mockResolvedValueOnce(handle);

    render(<App />);
    const user = userEvent.setup();
    await connect(user, "10.0.0.23");

    await user.click(screen.getByRole("button", { name: /^ctrl$/i }));
    act(() => terminalInput?.("r"));
    act(() => terminalInput?.("r"));

    expect(sentBytes(handle)).toBe("\x12r");
  });

  it("holds ctrl down until it is tapped off once it is locked", async () => {
    usePointer("coarse");
    const handle: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    vi.mocked(engine.connectSession).mockResolvedValueOnce(handle);

    render(<App />);
    const user = userEvent.setup();
    await connect(user, "10.0.0.24");

    const ctrl = screen.getByRole("button", { name: /^ctrl$/i });
    await user.click(ctrl);
    await user.click(ctrl);
    act(() => terminalInput?.("a"));
    act(() => terminalInput?.("b"));
    await user.click(ctrl);
    act(() => terminalInput?.("c"));

    expect(sentBytes(handle)).toBe("\x01\x02c");
    expect(ctrl).toHaveAttribute("aria-pressed", "false");
  });

  // The clipboard menu is a session tool: copy needs terminal output to select,
  // and paste needs somewhere to send it.
  it("offers the clipboard menu only during a session", async () => {
    const handle: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    vi.mocked(engine.connectSession).mockResolvedValueOnce(handle);

    render(<App />);
    expect(screen.queryByRole("button", { name: /^clipboard/i })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await connect(user, "10.0.0.30");
    expect(screen.getByRole("button", { name: /^clipboard/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /disconnect/i }));
    expect(screen.queryByRole("button", { name: /^clipboard/i })).not.toBeInTheDocument();
  });

  it("sends text pasted through the clipboard menu to the session", async () => {
    const handle: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    vi.mocked(engine.connectSession).mockResolvedValueOnce(handle);

    render(<App />);
    const user = userEvent.setup();
    await connect(user, "10.0.0.31");

    const field = screen.getByLabelText("Paste here");
    await user.click(field);
    await user.paste("whoami\n");

    expect(terminalPaste).toHaveBeenCalledWith("whoami\n");
  });

  it("reflects a terminal selection in the clipboard menu's accessible name", async () => {
    const handle: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
    vi.mocked(engine.connectSession).mockResolvedValueOnce(handle);

    render(<App />);
    const user = userEvent.setup();
    await connect(user, "10.0.0.32");

    expect(screen.getByRole("button", { name: "Clipboard" })).toBeInTheDocument();
    act(() => terminalSelectionChange?.(true));
    expect(
      screen.getByRole("button", { name: "Clipboard, selection ready to copy" }),
    ).toBeInTheDocument();
  });

  it("ignores invalid persisted terminal settings", () => {
    localStorage.setItem(
      "terminalSettings",
      JSON.stringify({
        fontSize: 200,
        fontFamily: "url(evil)",
        themeName: "Missing",
      }),
    );

    render(<App />);

    expect(screen.getByLabelText(/font size/i)).toHaveValue("14");
    expect(screen.getByLabelText(/font family/i)).toHaveValue(DEFAULT_FONT_FAMILY);
    expect(screen.getByLabelText(/color scheme/i)).toHaveValue(DEFAULT_THEME_NAME);
  });

  describe("help and recovery", () => {
    it("turns a relay close reason into a recovery step with Help and the raw detail", async () => {
      const raw =
        "ssh handshake: ssh: handshake failed: relay connection closed: target connection refused (code 1011)";
      vi.mocked(engine.connectSession).mockRejectedValueOnce(raw);

      render(<App />);
      const user = userEvent.setup();
      await submitConnect(user, "10.0.0.40");

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("The server refused the connection.");
      expect(alert).toHaveTextContent("Check the port number");
      expect(within(alert).getByText(raw)).toBeInTheDocument();

      const learnMore = within(alert).getByRole("button", {
        name: "Learn more about connection problems",
      });
      await user.click(learnMore);
      expect(screen.getByRole("heading", { name: "Fix a connection problem" })).toHaveFocus();
      await user.keyboard("{Escape}");
      await waitFor(() => expect(learnMore).toHaveFocus());
    });

    it("lists every likely cause when the relay cannot be reached", async () => {
      vi.mocked(engine.connectSession).mockRejectedValueOnce(
        "could not reach the relay: it may be down, or it refused this page's origin",
      );

      render(<App />);
      await submitConnect(userEvent.setup(), "10.0.0.41");

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Could not reach the relay.");
      expect(within(alert).getAllByRole("listitem")).toHaveLength(3);
      expect(alert).toHaveTextContent("ALLOWED_ORIGINS");
      expect(alert).toHaveTextContent("MAX_SESSIONS");
    });

    it("explains a dropped session instead of returning to a silent connect form", async () => {
      const handle: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
      vi.mocked(engine.connectSession).mockResolvedValueOnce(handle);

      render(<App />);
      await connect(userEvent.setup(), "10.0.0.42");
      const { onClose } = vi.mocked(engine.connectSession).mock.calls[0]![0];
      act(() => onClose("connection lost: relay connection closed (code 1006)"));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("The connection to the server was lost.");
      expect(screen.getByRole("button", { name: /^connect to server$/i })).toBeEnabled();
    });

    it("returns to the connect form without an error when the shell exits", async () => {
      const handle: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
      vi.mocked(engine.connectSession).mockResolvedValueOnce(handle);

      render(<App />);
      await connect(userEvent.setup(), "10.0.0.43");
      const { onClose } = vi.mocked(engine.connectSession).mock.calls[0]![0];
      act(() => onClose(""));

      expect(await screen.findByRole("button", { name: /^connect to server$/i })).toBeEnabled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("opens Help during a session without ending it", async () => {
      const handle: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
      vi.mocked(engine.connectSession).mockResolvedValueOnce(handle);

      render(<App />);
      const user = userEvent.setup();
      await connect(user, "10.0.0.44");

      await user.click(screen.getByRole("button", { name: "Help" }));
      expect(screen.getByRole("dialog", { name: "Help with localssh" })).toBeInTheDocument();
      await user.keyboard("{Escape}");

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByText("Connected", { exact: true })).toBeInTheDocument();
      expect(handle.close).not.toHaveBeenCalled();
    });

    it("opens Help over the host-key prompt and keeps Tab inside Help", async () => {
      vi.mocked(engine.connectSession).mockRejectedValueOnce(
        new engine.HostKeyRejectedError("10.0.0.45:22", "SHA256:deadbeef"),
      );

      render(<App />);
      const user = userEvent.setup();
      await submitConnect(user, "10.0.0.45");

      const prompt = await screen.findByRole("alertdialog", { name: "Verify host key" });
      const learnMore = within(prompt).getByRole("button", { name: /learn more/i });
      await user.click(learnMore);
      const help = screen.getByRole("dialog", { name: "Help with localssh" });
      expect(screen.getByRole("heading", { name: "Check the host key" })).toHaveFocus();

      await user.tab();
      expect(help).toContainElement(document.activeElement as HTMLElement);

      await user.keyboard("{Escape}");
      expect(screen.getByRole("alertdialog", { name: "Verify host key" })).toBeInTheDocument();
      await waitFor(() => expect(learnMore).toHaveFocus());
    });

    it("keeps a blocked copy staged while Help explains the manual route", async () => {
      const handle: engine.SshHandle = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
      vi.mocked(engine.connectSession).mockResolvedValueOnce(handle);
      terminalSelectionText = "uptime output";

      try {
        render(<App />);
        const user = userEvent.setup();
        await connect(user, "10.0.0.46");
        // After userEvent.setup, which installs a clipboard stub of its own.
        Object.defineProperty(navigator, "clipboard", {
          value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
          configurable: true,
        });
        Object.defineProperty(document, "execCommand", { value: () => false, configurable: true });
        act(() => terminalSelectionChange?.(true));

        await user.click(screen.getByRole("button", { name: /^clipboard/i }));
        await user.click(screen.getByRole("button", { name: "Copy selection" }));
        const learnMore = await screen.findByRole("button", {
          name: "Learn more about copy and paste",
        });
        await user.click(learnMore);
        expect(screen.getByRole("heading", { name: "Copy and paste" })).toHaveFocus();
        await user.keyboard("{Escape}");

        expect(screen.getByLabelText("Selection to copy manually")).toHaveValue("uptime output");
        await waitFor(() => expect(learnMore).toHaveFocus());
      } finally {
        Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
        delete (document as { execCommand?: unknown }).execCommand;
      }
    });
  });
});
