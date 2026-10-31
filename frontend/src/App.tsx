import { useCallback, useEffect, useRef, useState } from "react";
import { About } from "./components/About.js";
import { ClipboardMenu } from "./components/ClipboardMenu.js";
import { ConnectDialog, type ConnectFormValues } from "./components/ConnectDialog.js";
import { ConnectionError } from "./components/ConnectionError.js";
import { HostKeyPrompt } from "./components/HostKeyPrompt.js";
import { Help, HelpProvider } from "./components/Help.js";
import { Icon } from "./components/Icon.js";
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
import { loadTerminalFont } from "./terminalFonts.js";
import { DEFAULT_THEME_NAME, TERMINAL_THEMES } from "./terminalThemes.js";
import { trackViewportHeight } from "./viewportHeight.js";
import { useVault } from "./vault/useVault.js";

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
      tabId: number;
    }
  | { kind: "error"; message: string };

type TerminalTab = {
  id: number;
  host: string;
  target: string;
  handle: SshHandle | null;
  controls: TerminalControls | null;
  size: { cols: number; rows: number };
  pendingData: Uint8Array[];
  connecting?: boolean;
  inputError?: string;
  lostReason?: string;
};

export function App() {
  const vault = useVault();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [hasOpenedTerminal, setHasOpenedTerminal] = useState(false);
  const [notice, setNotice] = useState("");
  const tabsRef = useRef<TerminalTab[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const activeIdRef = useRef<number | null>(null);
  const nextTabIdRef = useRef(0);
  const [terminalSettings, setTerminalSettings] = useState(() => loadTerminalSettings());
  const [touchPointer] = useState(hasTouchPointer);
  const [terminalFocused, setTerminalFocused] = useState(false);
  const [terminalHasSelection, setTerminalHasSelection] = useState(false);
  const [modifiers, setModifiers] = useState<ModifierState>(NO_MODIFIERS);
  const connectionAttemptRef = useRef(0);
  const terminalSizeRef = useRef({ cols: 80, rows: 24 });
  // Input arrives from the terminal outside React's render cycle, so the armed
  // modifiers are held in a ref and mirrored into state for the key bar.
  const modifiersRef = useRef<ModifierState>(NO_MODIFIERS);

  const updateModifiers = useCallback((next: ModifierState) => {
    modifiersRef.current = next;
    setModifiers(next);
  }, []);

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? null;
  const currentTab = () => tabsRef.current.find((tab) => tab.id === activeIdRef.current);
  const selectTab = (id: number | null, focusTerminal = true) => {
    currentTab()?.controls?.blur();
    activeIdRef.current = id;
    setActiveId(id);
    updateModifiers(NO_MODIFIERS);
    setTerminalFocused(false);
    setTerminalHasSelection(false);
    setNotice("");
    if (id !== null)
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(`[aria-controls="terminal-panel-${id}"]`)
          ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        if (focusTerminal) tabsRef.current.find((tab) => tab.id === id)?.controls?.focus();
      });
  };

  useEffect(() => {
    const sessions = tabsRef;
    const attempts = connectionAttemptRef;
    const closeAll = () => {
      attempts.current++;
      for (const tab of sessions.current) tab.handle?.close();
      sessions.current = [];
    };
    window.addEventListener("pagehide", closeAll);
    return () => {
      window.removeEventListener("pagehide", closeAll);
      closeAll();
    };
  }, []);

  /** Sends input to the session, applying whichever modifiers are armed. */
  const sendInput = useCallback(
    (data: string) => {
      const { data: outgoing, next } = applyModifiers(data, modifiersRef.current);
      updateModifiers(next);
      const tab = currentTab();
      const error = tab?.handle?.write(ENCODER.encode(outgoing));
      if (error) {
        if (tab) tab.inputError = `Input was not sent: ${error}`;
        setTabs([...tabsRef.current]);
      }
    },
    [updateModifiers],
  );

  const sendKey = useCallback(
    (key: TerminalKey) => {
      const applicationCursorKeys = currentTab()?.controls?.applicationCursorMode() ?? false;
      sendInput(keySequence(key, applicationCursorKeys));
    },
    [sendInput],
  );

  // Focus is the only handle a page has on the on-screen keyboard: the terminal
  // holding it is what keeps the keyboard up, and dropping it puts it away.
  const toggleKeyboard = useCallback(() => {
    const controls = currentTab()?.controls;
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
    if (!activeTab) return;
    return lockPageScroll(document);
  }, [activeTab]);

  const updateTerminalSettings = useCallback((next: typeof terminalSettings) => {
    setTerminalSettings(next);
    saveTerminalSettings(next);
  }, []);

  useEffect(() => {
    void loadTerminalFont(terminalSettings.fontFamily);
  }, [terminalSettings.fontFamily]);

  const attemptConnect = async (values: ConnectFormValues, retryTab?: TerminalTab) => {
    const attempt = ++connectionAttemptRef.current;
    setStatus({ kind: "connecting" });
    const hostPort = `${values.host}:${values.port}`;
    const tab: TerminalTab = retryTab ?? {
      id: ++nextTabIdRef.current,
      host: values.host,
      target: `${values.username}@${hostPort}`,
      handle: null,
      controls: null,
      size: { ...terminalSizeRef.current },
      pendingData: [],
    };
    tab.connecting = true;
    if (!retryTab) {
      tabsRef.current = [...tabsRef.current, tab];
      setTabs(tabsRef.current);
    }
    let knownHosts = new Map<string, string>();

    try {
      knownHosts = await loadKnownHosts();
      const handle = await connectSession({
        relayWsUrl: RELAY_WS_URL,
        host: values.host,
        port: values.port,
        username: values.username,
        password: values.password,
        isTrustedFingerprint: (fingerprint) => knownHosts.get(hostPort) === fingerprint,
        onData: (chunk) => {
          if (tab.controls) tab.controls.write(chunk);
          else tab.pendingData.push(chunk);
        },
        onClose: (reason) => {
          if (!tabsRef.current.includes(tab)) return;
          tab.handle = null;
          tab.connecting = false;
          if (tabsRef.current.length === 1) {
            tab.controls?.reset();
            tab.controls?.blur();
            tabsRef.current = [];
            setTabs([]);
            selectTab(null);
            setStatus(reason ? { kind: "error", message: reason } : { kind: "idle" });
          } else if (!reason) {
            tabsRef.current = tabsRef.current.filter((entry) => entry !== tab);
            setTabs(tabsRef.current);
            if (activeIdRef.current === tab.id) selectTab(tabsRef.current.at(-1)?.id ?? null);
            setNotice(`${tab.host} disconnected. Other terminals are still open.`);
          } else {
            tab.lostReason = reason;
            setTabs([...tabsRef.current]);
          }
        },
      });
      if (connectionAttemptRef.current !== attempt || !tabsRef.current.includes(tab)) {
        handle.close();
        return;
      }
      tab.handle = handle;
      tab.connecting = false;
      setTabs([...tabsRef.current]);
      setHasOpenedTerminal(true);
      handle.resize(tab.size.cols, tab.size.rows);
      selectTab(tab.id);
      setStatus({ kind: "idle" });
    } catch (error) {
      if (connectionAttemptRef.current !== attempt || !tabsRef.current.includes(tab)) {
        if (values.password.kind === "key") values.password.privateKey.fill(0);
        return;
      }
      if (error instanceof HostKeyRejectedError) {
        const previousFingerprint = knownHosts.get(hostPort);
        setStatus({
          kind: "unknown-host",
          hostPort: error.hostPort,
          fingerprint: error.fingerprint,
          previousFingerprint,
          changed: previousFingerprint !== undefined,
          pending: values,
          tabId: tab.id,
        });
      } else {
        tabsRef.current = tabsRef.current.filter((entry) => entry !== tab);
        setTabs(tabsRef.current);
        if (values.password.kind === "key") values.password.privateKey.fill(0);
        setStatus({
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  const trustAndRetry = async () => {
    if (status.kind !== "unknown-host") return;
    try {
      await trustHostKey(status.hostPort, status.fingerprint);
      await attemptConnect(
        status.pending,
        tabsRef.current.find((tab) => tab.id === status.tabId),
      );
    } catch (error) {
      tabsRef.current = tabsRef.current.filter((tab) => tab.id !== status.tabId);
      setTabs(tabsRef.current);
      if (status.pending.password.kind === "key") status.pending.password.privateKey.fill(0);
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const terminalTheme =
    TERMINAL_THEMES[terminalSettings.themeName] ?? TERMINAL_THEMES[DEFAULT_THEME_NAME] ?? {};

  const closeTab = (id: number) => {
    const tab = tabsRef.current.find((entry) => entry.id === id);
    if (!tab) return;
    if (
      status.kind === "unknown-host" &&
      status.tabId === id &&
      status.pending.password.kind === "key"
    ) {
      status.pending.password.privateKey.fill(0);
    }
    tabsRef.current = tabsRef.current.filter((entry) => entry.id !== id);
    tab.handle?.close();
    tab.controls?.reset();
    tab.controls?.blur();
    setTabs(tabsRef.current);
    if (activeIdRef.current === id) selectTab(tabsRef.current.at(-1)?.id ?? null);
    if (!tabsRef.current.some((entry) => entry.connecting)) setStatus({ kind: "idle" });
    if (tabsRef.current.length > 0)
      setNotice(`${tab.host} disconnected. Other terminals are still open.`);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !event.ctrlKey ||
        !event.altKey ||
        !event.shiftKey ||
        !["ArrowLeft", "ArrowRight"].includes(event.key)
      )
        return;
      if (tabsRef.current.length < 2) return;
      event.preventDefault();
      event.stopPropagation();
      const index = tabsRef.current.findIndex((tab) => tab.id === activeIdRef.current);
      const step = event.key === "ArrowRight" ? 1 : -1;
      const next = (index + step + tabsRef.current.length) % tabsRef.current.length;
      selectTab(tabsRef.current[next]!.id);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });

  return (
    <HelpProvider>
      <main className={activeTab ? "app-shell app-shell--session" : "app-shell app-shell--connect"}>
        <header className="app-toolbar">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">
              &gt;_
            </span>
            <span className="toolbar-brand">localssh</span>
          </div>
          <div className="session-identity">
            <span
              className={`connection-status connection-status--${activeTab?.handle ? "connected" : status.kind}`}
              aria-live="polite"
            >
              {activeTab
                ? activeTab.handle
                  ? "Connected"
                  : "Offline"
                : status.kind === "connecting"
                  ? "Connecting"
                  : "Offline"}
            </span>
            {activeTab && <span className="active-target">{activeTab.target}</span>}
          </div>
          <div className="toolbar-actions">
            {activeTab?.handle && (
              <button
                className="toolbar-button"
                type="button"
                onClick={() => closeTab(activeTab.id)}
              >
                <Icon name="logout" />
                <span>Disconnect</span>
              </button>
            )}
            {activeTab?.handle && (
              <ClipboardMenu
                hasSelection={terminalHasSelection}
                getSelection={() => currentTab()?.controls?.getSelection() ?? ""}
                onPaste={(text) => currentTab()?.controls?.paste(text)}
              />
            )}
            <TerminalSettingsControl value={terminalSettings} onChange={updateTerminalSettings} />
            <Help />
            <About />
          </div>
        </header>

        {tabs.length > 0 && (
          <div className="terminal-tabs" role="tablist" aria-label="Open terminals">
            {tabs.map((tab) => (
              <div className="terminal-tabs__item" key={tab.id}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeId === tab.id}
                  aria-controls={`terminal-panel-${tab.id}`}
                  aria-label={`${tab.host}, ${tab.handle ? "connected" : tab.connecting ? "connecting" : "disconnected"}`}
                  onClick={() => selectTab(tab.connecting ? null : tab.id)}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                    event.preventDefault();
                    const index = tabs.findIndex((entry) => entry.id === tab.id);
                    const next =
                      tabs[
                        (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length
                      ];
                    if (next) {
                      selectTab(next.connecting ? null : next.id, false);
                      document
                        .querySelector<HTMLElement>(`[aria-controls="terminal-panel-${next.id}"]`)
                        ?.focus();
                    }
                  }}
                >
                  {tab.connecting ? `Connecting to ${tab.host}...` : tab.host}
                </button>
                <button
                  type="button"
                  aria-label={`Close ${tab.host} terminal`}
                  onClick={() => closeTab(tab.id)}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              className="terminal-tabs__new"
              type="button"
              disabled={status.kind === "connecting" || status.kind === "unknown-host"}
              onClick={() => {
                setStatus({ kind: "idle" });
                selectTab(null);
              }}
            >
              New terminal
            </button>
          </div>
        )}
        {notice && (
          <p className="terminal-tabs__notice" role="status">
            {notice}
          </p>
        )}

        <div className="workspace">
          {!activeTab && (
            <>
              {tabs.length === 0 && hasOpenedTerminal && (
                <p className="terminal-empty">
                  No open terminals. Connect to a server to start one.
                </p>
              )}
              <ConnectDialog
                vault={vault}
                onConnect={attemptConnect}
                disabled={status.kind === "connecting"}
                error={status.kind === "error" ? <ConnectionError raw={status.message} /> : null}
              />
            </>
          )}
          {activeTab?.inputError && (
            <p className="connection-error" role="alert">
              {activeTab.inputError}
            </p>
          )}
          {activeTab?.lostReason && <ConnectionError raw={activeTab.lostReason} />}
          {tabs.length === 0 && (
            <div className="terminal-frame" aria-label="SSH terminal" hidden>
              <div className="terminal-frame__viewport">
                <Terminal
                  onReady={() => {}}
                  onInput={() => {}}
                  onResize={(cols, rows) => {
                    terminalSizeRef.current = { cols, rows };
                  }}
                  fontSize={terminalSettings.fontSize}
                  fontFamily={terminalSettings.fontFamily}
                  theme={terminalTheme}
                  active={false}
                />
              </div>
            </div>
          )}
          {tabs.map((tab) => (
            <div
              className="terminal-frame"
              id={`terminal-panel-${tab.id}`}
              role="tabpanel"
              aria-label={`${tab.host} terminal`}
              key={tab.id}
              hidden={activeId !== tab.id}
            >
              <div className="terminal-frame__viewport">
                <Terminal
                  onReady={(controls) => {
                    tab.controls = controls;
                    for (const chunk of tab.pendingData) controls.write(chunk);
                    tab.pendingData = [];
                  }}
                  onInput={(data) => {
                    if (activeIdRef.current === tab.id) sendInput(data);
                  }}
                  onFocusChange={(focused) => {
                    if (activeIdRef.current === tab.id) setTerminalFocused(focused);
                  }}
                  onSelectionChange={(selected) => {
                    if (activeIdRef.current === tab.id) setTerminalHasSelection(selected);
                  }}
                  onResize={(cols, rows) => {
                    tab.size = { cols, rows };
                    tab.handle?.resize(cols, rows);
                  }}
                  fontSize={terminalSettings.fontSize}
                  fontFamily={terminalSettings.fontFamily}
                  theme={terminalTheme}
                  active={activeId === tab.id && !!tab.handle}
                />
              </div>
            </div>
          ))}
        </div>

        {/* The bar rides on the shell, which is pinned to the visual viewport, so
          it sits directly above the on-screen keyboard whenever that is open.
          It stays up when the keyboard is not: its keys write to the session
          without going through the terminal's focus, so a previous command can
          be recalled and run from the bar alone. */}
        {activeTab?.handle && touchPointer && (
          <KeyBar
            modifiers={modifiers}
            keyboardUp={terminalFocused}
            onToggleKeyboard={toggleKeyboard}
            onToggleModifier={toggleModifier}
            onKey={sendKey}
          />
        )}

        {status.kind === "unknown-host" && !activeTab && (
          <HostKeyPrompt
            hostPort={status.hostPort}
            fingerprint={status.fingerprint}
            changed={status.changed}
            previousFingerprint={status.previousFingerprint}
            onTrust={trustAndRetry}
            onSwitch={
              tabs.some((tab) => tab.id !== status.tabId && tab.handle)
                ? () =>
                    selectTab(
                      tabsRef.current.find((tab) => tab.id !== status.tabId && tab.handle)?.id ??
                        null,
                    )
                : undefined
            }
            onCancel={() => {
              if (status.pending.password.kind === "key")
                status.pending.password.privateKey.fill(0);
              tabsRef.current = tabsRef.current.filter((tab) => tab.id !== status.tabId);
              setTabs(tabsRef.current);
              setStatus({ kind: "idle" });
            }}
          />
        )}
      </main>
    </HelpProvider>
  );
}
