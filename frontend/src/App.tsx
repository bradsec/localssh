import { useCallback, useRef, useState } from "react";
import { About } from "./components/About.js";
import { ConnectDialog, type ConnectFormValues } from "./components/ConnectDialog.js";
import { HostKeyPrompt } from "./components/HostKeyPrompt.js";
import { Terminal, type TerminalControls } from "./components/Terminal.js";
import { TerminalSettings as TerminalSettingsControl } from "./components/TerminalSettings.js";
import { connectSession, HostKeyRejectedError, type SshHandle } from "./ssh/engine.js";
import { loadKnownHosts, trustHostKey } from "./storage/knownHostsStore.js";
import { loadTerminalSettings, saveTerminalSettings } from "./storage/settingsStore.js";
import { DEFAULT_THEME_NAME, TERMINAL_THEMES } from "./terminalThemes.js";

const RELAY_WS_URL = import.meta.env.VITE_RELAY_WS_URL ?? "ws://127.0.0.1:8787";

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
  const handleRef = useRef<SshHandle | null>(null);
  const terminalControlsRef = useRef<TerminalControls | null>(null);
  const terminalSizeRef = useRef({ cols: 80, rows: 24 });

  // Pinch-to-zoom updates the font size from a listener attached once, so it
  // reads the latest settings through a ref rather than a stale closure.
  const terminalSettingsRef = useRef(terminalSettings);

  const updateTerminalSettings = useCallback((next: typeof terminalSettings) => {
    terminalSettingsRef.current = next;
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
          // display behind the connect form.
          terminalControlsRef.current?.reset();
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
  }, []);

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
    setStatus({ kind: "idle" });
  }, []);

  return (
    <main className="app-shell">
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
              onInput={(data) => handleRef.current?.write(new TextEncoder().encode(data))}
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
              onFontSizeChange={(nextFontSize) =>
                updateTerminalSettings({ ...terminalSettingsRef.current, fontSize: nextFontSize })
              }
              fontSize={terminalSettings.fontSize}
              fontFamily={terminalSettings.fontFamily}
              theme={terminalTheme}
              active={status.kind === "connected"}
            />
          </div>
        </div>
      </div>

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
