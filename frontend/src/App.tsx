import { useCallback, useEffect, useRef, useState } from "react";
import { About } from "./components/About.js";
import { ConnectDialog, type ConnectFormValues } from "./components/ConnectDialog.js";
import { HostKeyPrompt } from "./components/HostKeyPrompt.js";
import { KeyBar } from "./components/KeyBar.js";
import { Terminal, type TerminalControls } from "./components/Terminal.js";
import { TerminalSettings as TerminalSettingsControl } from "./components/TerminalSettings.js";
import { connectSession, HostKeyRejectedError, type SshHandle } from "./ssh/engine.js";
import { loadKnownHosts, trustHostKey } from "./storage/knownHostsStore.js";
import { loadTerminalSettings, saveTerminalSettings } from "./storage/settingsStore.js";
import { lockPageScroll } from "./pageScrollLock.js";
import { resolveRelayWsUrl } from "./relayUrl.js";
import {
  applyModifiers,
  cycleModifier,
  keySequence,
  NO_MODIFIERS,
  type ModifierName,
  type ModifierState,
  type TerminalKey,
} from "./terminalKeys.js";
import { DEFAULT_THEME_NAME, TERMINAL_THEMES } from "./terminalThemes.js";
import { trackViewportHeight } from "./viewportHeight.js";

const RELAY_WS_URL = resolveRelayWsUrl(import.meta.env.VITE_RELAY_WS_URL, window.location);
const ENCODER = new TextEncoder();

/**
 * Whether the primary pointer is a finger. The key bar stands in for keys an
 * on-screen keyboard lacks, so it belongs only to devices driven by touch.
 */
function hasTouchPointer(): boolean {
  return window.matchMedia?.("(pointer: coarse)").matches ?? false;
}

type Status =
  | { kind: "idle" }
  | { kind: "connecting" }
  | {
      kind: "unknown-host";
      hostPort: string;
      fingerprint: string;
      changed: boolean;
      previousFingerprint?: string;
      pending: ConnectFormValues;
    }
  | { kind: "connected" }
  | { kind: "error"; message: string };

export function App() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [activeTarget, setActiveTarget] = useState<string | null>(null);
  const [terminalSize, setTerminalSize] = useState({ cols: 80, rows: 24 });
  const [terminalSettings, setTerminalSettings] = useState(() => loadTerminalSettings());
  const [touchPointer] = useState(hasTouchPointer);
  const [terminalFocused, setTerminalFocused] = useState(false);
  const [modifiers, setModifiers] = useState<ModifierState>(NO_MODIFIERS);
  const handleRef = useRef<SshHandle | null>(null);
  const terminalControlsRef = useRef<TerminalControls | null>(null);
  const terminalSizeRef = useRef({ cols: 80, rows: 24 });
  // Input arrives from the terminal outside React's render cycle, so the armed
  // modifiers are held in a ref and mirrored into state for the key bar.
  const modifiersRef = useRef<ModifierState>(NO_MODIFIERS);

  const updateModifiers = useCallback((next: ModifierState) => {
    modifiersRef.current = next;
    setModifiers(next);
  }, []);

  /** Sends input to the session, applying whichever modifiers are armed. */
  const sendInput = useCallback(
    (data: string) => {
      const { data: outgoing, next } = applyModifiers(data, modifiersRef.current);
      updateModifiers(next);
      handleRef.current?.write(ENCODER.encode(outgoing));
    },
    [updateModifiers],
  );

  const sendKey = useCallback(
    (key: TerminalKey) => {
      const applicationCursorKeys = terminalControlsRef.current?.applicationCursorMode() ?? false;
      sendInput(keySequence(key, applicationCursorKeys));
    },
    [sendInput],
  );

  // Focus is the only handle a page has on the on-screen keyboard: the terminal
  // holding it is what keeps the keyboard up, and dropping it puts it away.
  const toggleKeyboard = useCallback(() => {
    const controls = terminalControlsRef.current;
    if (!controls) return;
    if (terminalFocused) controls.blur();
    else controls.focus();
  }, [terminalFocused]);

  const toggleModifier = useCallback(
    (name: ModifierName) => {
      updateModifiers({
        ...modifiersRef.current,
        [name]: cycleModifier(modifiersRef.current[name]),
      });
    },
    [updateModifiers],
  );

  // Publishes the visual viewport height for the stylesheet. Only a connected
  // session consumes it: see .app-shell--session for why the connect form must
  // keep the full layout viewport instead.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    return trackViewportHeight(viewport, document.documentElement);
  }, []);

  // Only during a session: the connect form is a page that may need panning to
  // put a field above the keyboard, while the session fills the screen exactly
  // and any pan of it just slides the terminal away.
  useEffect(() => {
    if (status.kind !== "connected") return;
    return lockPageScroll(document);
  }, [status.kind]);

  const updateTerminalSettings = useCallback((next: typeof terminalSettings) => {
    setTerminalSettings(next);
    saveTerminalSettings(next);
  }, []);

  const attemptConnect = useCallback(async (values: ConnectFormValues) => {
    setStatus({ kind: "connecting" });
    const hostPort = `${values.host}:${values.port}`;
    const knownHosts = await loadKnownHosts();

    try {
      const handle = await connectSession({
        relayWsUrl: RELAY_WS_URL,
        host: values.host,
        port: values.port,
        username: values.username,
        password: values.password,
        isTrustedFingerprint: (fingerprint) => knownHosts.get(hostPort) === fingerprint,
        onData: (chunk) => terminalControlsRef.current?.write(chunk),
        onClose: () => {
          handleRef.current = null;
          setActiveTarget(null);
          // Wipe the screen so a closed session's output is not left on
          // display behind the connect form, and drop focus so a phone's
          // keyboard does not sit over the connect form.
          terminalControlsRef.current?.reset();
          terminalControlsRef.current?.blur();
          updateModifiers(NO_MODIFIERS);
          setStatus({ kind: "idle" });
        },
      });
      handleRef.current = handle;
      setActiveTarget(`${values.username}@${hostPort}`);
      handle.resize(terminalSizeRef.current.cols, terminalSizeRef.current.rows);
      setStatus({ kind: "connected" });
      requestAnimationFrame(() => terminalControlsRef.current?.focus());
    } catch (error) {
      if (error instanceof HostKeyRejectedError) {
        const previousFingerprint = knownHosts.get(hostPort);
        setStatus({
          kind: "unknown-host",
          hostPort: error.hostPort,
          fingerprint: error.fingerprint,
          previousFingerprint,
          changed: previousFingerprint !== undefined,
          pending: values,
        });
      } else {
        setStatus({
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }, [updateModifiers]);

  const trustAndRetry = useCallback(async () => {
    if (status.kind !== "unknown-host") return;
    await trustHostKey(status.hostPort, status.fingerprint);
    await attemptConnect(status.pending);
  }, [status, attemptConnect]);

  const terminalTheme =
    TERMINAL_THEMES[terminalSettings.themeName] ??
    TERMINAL_THEMES[DEFAULT_THEME_NAME] ??
    {};

  const disconnect = useCallback(() => {
    handleRef.current?.close();
    handleRef.current = null;
    setActiveTarget(null);
    terminalControlsRef.current?.reset();
    terminalControlsRef.current?.blur();
    updateModifiers(NO_MODIFIERS);
    setStatus({ kind: "idle" });
  }, [updateModifiers]);

  return (
    <main className={status.kind === "connected" ? "app-shell app-shell--session" : "app-shell"}>
      <header className="app-toolbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">&gt;_</span>
          <span className="toolbar-brand">localssh</span>
        </div>
        <div className="session-identity">
          <span className={`connection-status connection-status--${status.kind}`} aria-live="polite">
            {status.kind === "connected"
              ? "Connected"
              : status.kind === "connecting"
                ? "Connecting"
                : "Offline"}
          </span>
          {activeTarget && <span className="active-target">{activeTarget}</span>}
        </div>
        <div className="toolbar-actions">
          {status.kind === "connected" && (
            <button className="toolbar-button" type="button" onClick={disconnect}>
              Disconnect
            </button>
          )}
          <TerminalSettingsControl value={terminalSettings} onChange={updateTerminalSettings} />
          <About />
        </div>
      </header>

      <div className="workspace">
        {status.kind !== "connected" && (
          <ConnectDialog onConnect={attemptConnect} disabled={status.kind === "connecting"} />
        )}
        {status.kind === "error" && (
          <p className="connection-error" role="alert">
            {status.message}
          </p>
        )}
        <div className="terminal-frame" aria-label="SSH terminal">
          <div className="terminal-frame__bar" aria-hidden="true">
            <span className="terminal-frame__title">{activeTarget ?? "No active session"}</span>
            <span className="terminal-frame__dims">
              {terminalSize.cols}&times;{terminalSize.rows}
            </span>
          </div>
          <div className="terminal-frame__viewport">
            <Terminal
              onReady={(controls) => {
                terminalControlsRef.current = controls;
              }}
              onInput={sendInput}
              onFocusChange={setTerminalFocused}
              onResize={(cols, rows) => {
                terminalSizeRef.current = { cols, rows };
                // Returning the previous object when nothing changed lets React
                // bail out, so a re-fit that lands on the same geometry does not
                // re-render (and cannot loop if onResize fires during a render).
                setTerminalSize((previous) =>
                  previous.cols === cols && previous.rows === rows ? previous : { cols, rows },
                );
                handleRef.current?.resize(cols, rows);
              }}
              fontSize={terminalSettings.fontSize}
              fontFamily={terminalSettings.fontFamily}
              theme={terminalTheme}
              active={status.kind === "connected"}
            />
          </div>
        </div>
      </div>

      {/* The bar rides on the shell, which is pinned to the visual viewport, so
          it sits directly above the on-screen keyboard whenever that is open.
          It stays up when the keyboard is not: its keys write to the session
          without going through the terminal's focus, so a previous command can
          be recalled and run from the bar alone. */}
      {status.kind === "connected" && touchPointer && (
        <KeyBar
          modifiers={modifiers}
          keyboardUp={terminalFocused}
          onToggleKeyboard={toggleKeyboard}
          onToggleModifier={toggleModifier}
          onKey={sendKey}
        />
      )}

      {status.kind === "unknown-host" && (
        <HostKeyPrompt
          hostPort={status.hostPort}
          fingerprint={status.fingerprint}
          changed={status.changed}
          previousFingerprint={status.previousFingerprint}
          onTrust={trustAndRetry}
          onCancel={() => setStatus({ kind: "idle" })}
        />
      )}
    </main>
  );
}
