import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FolderOpen, LogOut, LucideProvider, Plus, Unplug, X } from "lucide-react";
import { ActionsMenu } from "./components/ActionsMenu.js";
import { About } from "./components/About.js";
import { ClipboardMenu } from "./components/ClipboardMenu.js";
import { ConnectDialog, type ConnectFormValues } from "./components/ConnectDialog.js";
import { ConnectionError } from "./components/ConnectionError.js";
import { FilePanel } from "./components/FilePanel.js";
import { HostKeyPrompt } from "./components/HostKeyPrompt.js";
import { Help, HelpProvider } from "./components/Help.js";
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
import { ToastProvider } from "./components/Toasts.js";
import { useToast } from "./toast.js";

const RELAY_WS_URL = resolveRelayWsUrl(import.meta.env.VITE_RELAY_WS_URL, window.location);
const ENCODER = new TextEncoder();

/**
 * Whether the primary pointer is a finger. The key bar stands in for keys an
 * on-screen keyboard lacks, so it belongs only to devices driven by touch.
 */
function hasTouchPointer(): boolean {
  return window.matchMedia?.("(pointer: coarse)").matches ?? false;
}

/**
 * Below the desktop breakpoint the session controls do not fit in one row next
 * to the brand and the target, so they move into the Actions menu.
 */
const COMPACT_TOOLBAR_QUERY = "(max-width: 1023px)";

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia?.(query);
      list?.addEventListener?.("change", onChange);
      return () => list?.removeEventListener?.("change", onChange);
    },
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  );
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

/** Zeroes the key bytes and drops the passphrase of values that will never be sent. */
function wipeKey(values: ConnectFormValues) {
  if (values.password.kind !== "key") return;
  values.password.privateKey.fill(0);
  values.password.passphrase = "";
}

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
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}

function AppContent() {
  const toast = useToast();
  const vault = useVault();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [fileTabs, setFileTabs] = useState<Set<number>>(() => new Set());
  const [expandedFiles, setExpandedFiles] = useState<Set<number>>(() => new Set());
  const [hasOpenedTerminal, setHasOpenedTerminal] = useState(false);
  const tabsRef = useRef<TerminalTab[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const activeIdRef = useRef<number | null>(null);
  const nextTabIdRef = useRef(0);
  const [terminalSettings, setTerminalSettings] = useState(() => loadTerminalSettings());
  const [touchPointer] = useState(hasTouchPointer);
  const compactToolbar = useMediaQuery(COMPACT_TOOLBAR_QUERY);
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
    if (tabsRef.current.find((tab) => tab.id === id)?.connecting) id = null;
    currentTab()?.controls?.blur();
    activeIdRef.current = id;
    setActiveId(id);
    updateModifiers(NO_MODIFIERS);
    setTerminalFocused(false);
    setTerminalHasSelection(false);
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
    // A new connection replaces a pending host-key prompt; its key is unusable now.
    if (!retryTab && status.kind === "unknown-host") wipeKey(status.pending);
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
          toast(
            reason ? `Session lost: ${tab.host}. ${reason}` : `Session ended: ${tab.host}.`,
            reason ? "error" : "info",
          );
          tab.handle = null;
          setFileTabs((open) => {
            const next = new Set(open);
            next.delete(tab.id);
            return next;
          });
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
      const tab = tabsRef.current.find((entry) => entry.id === status.tabId);
      if (!tab) {
        if (status.pending.password.kind === "key") status.pending.password.privateKey.fill(0);
        setStatus((current) =>
          current.kind === "unknown-host" && current.tabId === status.tabId
            ? { kind: "idle" }
            : current,
        );
        return;
      }
      await attemptConnect(status.pending, tab);
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
    setFileTabs((open) => {
      const next = new Set(open);
      next.delete(id);
      return next;
    });
    setExpandedFiles((open) => {
      const next = new Set(open);
      next.delete(id);
      return next;
    });
    tab.handle?.close();
    tab.controls?.reset();
    tab.controls?.blur();
    setTabs(tabsRef.current);
    if (activeIdRef.current === id) selectTab(tabsRef.current.at(-1)?.id ?? null);
    if (!tabsRef.current.some((entry) => entry.connecting)) setStatus({ kind: "idle" });
    toast(`Session ended: ${tab.host}.`, "info");
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

  const connectionLabel = activeTab
    ? activeTab.handle
      ? "Connected"
      : "Offline"
    : status.kind === "connecting"
      ? "Connecting"
      : "";

  const toggleFiles = (id: number) =>
    setFileTabs((open) => {
      const next = new Set(open);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** The controls for the live session, followed by the ones every screen has. */
  const toolbarControls = (afterAction: () => void = () => {}) => (
    <>
      {activeTab?.handle && (
        <button
          className="toolbar-button"
          type="button"
          aria-pressed={fileTabs.has(activeTab.id)}
          onClick={() => {
            toggleFiles(activeTab.id);
            afterAction();
          }}
        >
          <FolderOpen />
          <span>Files</span>
        </button>
      )}
      {activeTab?.handle && (
        <button
          className="toolbar-button"
          type="button"
          onClick={() => {
            closeTab(activeTab.id);
            afterAction();
          }}
        >
          <LogOut />
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
    </>
  );

  return (
    <LucideProvider size={18} strokeWidth={2} className="icon">
      <HelpProvider>
        <main
          className={activeTab ? "app-shell app-shell--session" : "app-shell app-shell--connect"}
        >
          <header className="app-toolbar">
            <span className="toolbar-brand">localssh</span>
            <div className="session-identity">
              <span className="connection-status" aria-live="polite">
                {connectionLabel}
              </span>
              {activeTab && <span className="active-target">{activeTab.target}</span>}
            </div>
            {activeTab && compactToolbar ? (
              <ActionsMenu>{(close) => toolbarControls(close)}</ActionsMenu>
            ) : (
              <div className="toolbar-actions">{toolbarControls()}</div>
            )}
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
                    onClick={() => selectTab(tab.id)}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                      event.preventDefault();
                      const index = tabs.findIndex((entry) => entry.id === tab.id);
                      const next =
                        tabs[
                          (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
                            tabs.length
                        ];
                      if (next) {
                        selectTab(next.id, false);
                        document
                          .querySelector<HTMLElement>(`[aria-controls="terminal-panel-${next.id}"]`)
                          ?.focus();
                      }
                    }}
                  >
                    {!tab.handle && !tab.connecting && <Unplug />}
                    <span className="terminal-tabs__host">
                      {tab.connecting ? `Connecting to ${tab.host}...` : tab.host}
                    </span>
                    {!tab.handle && !tab.connecting && (
                      <span className="terminal-tabs__state">Disconnected</span>
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label={`Close ${tab.host} terminal`}
                    onClick={() => closeTab(tab.id)}
                  >
                    <X />
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
                <Plus />
                <span>New terminal</span>
              </button>
            </div>
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
                className={`terminal-frame${fileTabs.has(tab.id) ? " terminal-frame--files" : ""}${expandedFiles.has(tab.id) ? " terminal-frame--files-expanded" : ""}`}
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
                {fileTabs.has(tab.id) && tab.handle && (
                  <FilePanel
                    handle={tab.handle}
                    expanded={expandedFiles.has(tab.id)}
                    onExpand={() =>
                      setExpandedFiles((open) => {
                        const next = new Set(open);
                        if (next.has(tab.id)) next.delete(tab.id);
                        else next.add(tab.id);
                        return next;
                      })
                    }
                    onClose={() => {
                      setFileTabs((open) => {
                        const next = new Set(open);
                        next.delete(tab.id);
                        return next;
                      });
                    }}
                  />
                )}
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
    </LucideProvider>
  );
}
