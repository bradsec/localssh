import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ChevronDown,
  FolderOpen,
  LogOut,
  LucideProvider,
  Plus,
  Settings,
  Unplug,
  X,
} from "lucide-react";
import { ActionsMenu } from "./components/ActionsMenu.js";
import { About } from "./components/About.js";
import { ClipboardMenu } from "./components/ClipboardMenu.js";
import { ConnectDialog, type ConnectFormValues } from "./components/ConnectDialog.js";
import { ConnectionError } from "./components/ConnectionError.js";
import { FilePanel } from "./components/FilePanel.js";
import { HostKeyPrompt } from "./components/HostKeyPrompt.js";
import { Help, HelpProvider } from "./components/Help.js";
import { KeyBar } from "./components/KeyBar.js";
import { RecoveryRow } from "./components/RecoveryRow.js";
import { Terminal, type TerminalControls } from "./components/Terminal.js";
import { SettingsDialog } from "./components/SettingsDialog.js";
import { connectSession, HostKeyRejectedError, type SshHandle } from "./ssh/engine.js";
import { loadKnownHosts, trustHostKey } from "./storage/knownHostsStore.js";
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  loadTerminalSettings,
  saveTerminalSettings,
  type TerminalSettings,
} from "./storage/settingsStore.js";
import { lockPageScroll } from "./pageScrollLock.js";
import { requestedGraceMs } from "./keepAlive.js";
import { fetchRelayCapabilities, type RelayCapabilities } from "./relayCapabilities.js";
import { resolveRelayWsUrl } from "./relayUrl.js";
import { isShortLandscape } from "./shortLandscape.js";
import {
  applyModifiers,
  cycleModifier,
  KEY_BAR_KEYS,
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
import type { SavedEntry, TerminalPrefs } from "./vault/vaultEngine.js";
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
const PHONE_QUERY = "(max-width: 719px)";

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

/** Drawn faint between a closed session's output and its replacement's (S-18). */
const RECONNECT_MARKER = ENCODER.encode(
  "\r\n\x1b[2m[localssh] New connection. Output above is from the closed session.\x1b[22m\r\n",
);

type TerminalTab = {
  id: number;
  host: string;
  port: number;
  username: string;
  /** The vault entry that supplied the password; typed passwords and keys are never kept. */
  entryId?: string;
  target: string;
  handle: SshHandle | null;
  controls: TerminalControls | null;
  size: { cols: number; rows: number };
  pendingData: Uint8Array[];
  connecting?: boolean;
  inputError?: string;
  lostReason?: string;
  transport?: "connected" | "resuming";
  /** The download in progress, kept when the session ends so the recovery row can say where it stopped. */
  download?: { name: string; percent: number };
  grantedGraceMs?: number | null;
  lostWhileHidden?: boolean;
  /** Set while a Reconnect attempt is replacing this closed tab's session. */
  reconnecting?: boolean;
  reconnectError?: string;
};

function effectiveTerminalSettings(
  global: TerminalSettings,
  entry?: SavedEntry,
  vaultUnlocked = false,
): TerminalSettings {
  return vaultUnlocked && entry?.terminal ? { ...global, ...entry.terminal } : global;
}

function recordDownload(tab: TerminalTab, info: TerminalTab["download"] | null) {
  tab.download = info ?? undefined;
}

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
  const capabilitiesRef = useRef<RelayCapabilities | "unknown">("unknown");
  const pageHiddenRef = useRef(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  const activeIdRef = useRef<number | null>(null);
  const pendingFocusRef = useRef<number | null>(null);
  const nextTabIdRef = useRef(0);
  const [terminalSettings, setTerminalSettings] = useState(() => loadTerminalSettings());
  const terminalSettingsRef = useRef(terminalSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsReturnFocusRef = useRef<HTMLElement | null>(null);
  const [touchPointer] = useState(hasTouchPointer);
  const compactToolbar = useMediaQuery(COMPACT_TOOLBAR_QUERY);
  const phoneWidth = useMediaQuery(PHONE_QUERY);
  const [shortLandscape, setShortLandscape] = useState(false);
  const combinedRow = touchPointer && shortLandscape;
  const phoneScreen = phoneWidth || combinedRow;
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);
  const switcherButtonRef = useRef<HTMLButtonElement>(null);
  const [terminalFocused, setTerminalFocused] = useState(false);
  const [morePanelOpen, setMorePanelOpen] = useState(false);
  const [keyBarCapacity, setKeyBarCapacity] = useState<number | undefined>();
  const keyboardBeforePanelRef = useRef(false);
  const [terminalHasSelection, setTerminalHasSelection] = useState(false);
  const [sessionAnnouncement, setSessionAnnouncement] = useState("");
  const [textView, setTextView] = useState<{ tabId: number; text: string } | null>(null);
  const textViewRef = useRef<number | null>(null);
  const [modifiers, setModifiers] = useState<ModifierState>(NO_MODIFIERS);
  const connectionAttemptRef = useRef(0);
  // The closed tab a prefilled connect form will replace in place (S-17).
  const [pendingReconnectId, setPendingReconnectId] = useState<number | null>(null);
  const pendingReconnectRef = useRef<number | null>(null);
  const setPendingReconnect = (id: number | null) => {
    pendingReconnectRef.current = id;
    setPendingReconnectId(id);
  };
  const terminalSizeRef = useRef({ cols: 80, rows: 24 });
  // Input arrives from the terminal outside React's render cycle, so the armed
  // modifiers are held in a ref and mirrored into state for the key bar.
  const modifiersRef = useRef<ModifierState>(NO_MODIFIERS);

  const updateModifiers = useCallback((next: ModifierState) => {
    modifiersRef.current = next;
    setModifiers(next);
  }, []);

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? null;
  // S-20: the More keys panel closes on a session change, Files, Settings or
  // Resuming. State adjusted during render, as React recommends over an effect.
  const panelContext = [
    activeId,
    activeId !== null && fileTabs.has(activeId),
    settingsOpen,
    activeTab?.transport === "resuming",
  ].join("|");
  const [seenPanelContext, setSeenPanelContext] = useState(panelContext);
  if (seenPanelContext !== panelContext) {
    setSeenPanelContext(panelContext);
    setMorePanelOpen(false);
  }

  const currentTab = () => tabsRef.current.find((tab) => tab.id === activeIdRef.current);
  const focusPendingTerminal = (id: number) => {
    if (pendingFocusRef.current !== id || activeIdRef.current !== id) return;
    const panel = document.getElementById(`terminal-panel-${id}`);
    const controls = tabsRef.current.find((tab) => tab.id === id)?.controls;
    if (!panel || panel.hidden || !controls) return;
    pendingFocusRef.current = null;
    controls.focus();
  };
  const selectTab = (id: number | null, focusTerminal = true) => {
    setSwitcherOpen(false);
    if (tabsRef.current.find((tab) => tab.id === id)?.connecting) id = null;
    if (id !== null) setPendingReconnect(null);
    textViewRef.current = null;
    setTextView(null);
    currentTab()?.controls?.blur();
    activeIdRef.current = id;
    pendingFocusRef.current = focusTerminal ? id : null;
    setActiveId(id);
    updateModifiers(NO_MODIFIERS);
    setTerminalFocused(false);
    setTerminalHasSelection(false);
    if (id !== null)
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(`[aria-controls="terminal-panel-${id}"]`)
          ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        focusPendingTerminal(id);
      });
  };

  useEffect(() => {
    if (activeId !== null) focusPendingTerminal(activeId);
  }, [activeId]);

  useEffect(() => {
    const cancelPendingFocus = () => {
      pendingFocusRef.current = null;
    };
    document.addEventListener("focusin", cancelPendingFocus);
    return () => document.removeEventListener("focusin", cancelPendingFocus);
  }, []);

  useEffect(() => {
    void fetchRelayCapabilities(RELAY_WS_URL).then((result) => {
      capabilitiesRef.current = result;
    });
  }, []);

  useEffect(() => {
    const sessions = tabsRef;
    const attempts = connectionAttemptRef;
    const onPageHide = () => {
      pageHiddenRef.current = true;
      for (const tab of sessions.current) {
        if (!tab.handle) continue;
        tab.lostWhileHidden = true;
        if (tab.transport) tab.handle.detach?.();
        else tab.handle.close();
      }
    };
    const onReturn = () => {
      pageHiddenRef.current = false;
      for (const tab of sessions.current) {
        if (tab.handle && tab.transport) tab.handle.resume?.();
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") onReturn();
    };
    const closeAll = () => {
      attempts.current++;
      for (const tab of sessions.current) tab.handle?.close();
      sessions.current = [];
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onReturn);
    window.addEventListener("online", onReturn);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onReturn);
      window.removeEventListener("online", onReturn);
      document.removeEventListener("visibilitychange", onVisible);
      closeAll();
    };
  }, []);

  /** Sends input to the session, applying whichever modifiers are armed. */
  const sendInput = useCallback(
    (data: string) => {
      if (textViewRef.current !== null || currentTab()?.transport === "resuming") return;
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

  const updateTerminalSettings = useCallback((next: typeof terminalSettings) => {
    terminalSettingsRef.current = next;
    setTerminalSettings(next);
    return saveTerminalSettings(next);
  }, []);

  const keyBarKeys = useMemo(
    () =>
      terminalSettings.keyBarKeys.flatMap((id) => KEY_BAR_KEYS.find((key) => key.id === id) ?? []),
    [terminalSettings.keyBarKeys],
  );

  const saveHostTerminal = useCallback(
    (entry: SavedEntry, terminal: TerminalPrefs | null) =>
      vault.save({
        id: entry.id,
        nickname: entry.nickname,
        host: entry.host,
        port: entry.port,
        username: entry.username ?? "",
        terminal,
      }),
    [vault],
  );

  const sendKey = useCallback(
    (key: TerminalKey) => {
      if (key.action) {
        const tab = currentTab();
        const entry =
          vault.status === "unlocked" && tab?.entryId
            ? vault.entries.find((saved) => saved.id === tab.entryId)
            : undefined;
        const current = entry?.terminal ?? terminalSettingsRef.current;
        const size = Math.min(
          FONT_SIZE_MAX,
          Math.max(FONT_SIZE_MIN, current.fontSize + (key.action === "text-larger" ? 1 : -1)),
        );
        if (entry?.terminal) {
          if (size !== current.fontSize) {
            void saveHostTerminal(entry, { ...entry.terminal, fontSize: size }).then((ok) => {
              if (!ok) toast("Could not save text size.", "error");
            });
          }
        } else updateTerminalSettings({ ...terminalSettingsRef.current, fontSize: size });
        setSessionAnnouncement(
          size === FONT_SIZE_MAX
            ? `Text size ${size} px, the largest.`
            : size === FONT_SIZE_MIN
              ? `Text size ${size} px, the smallest.`
              : `Text size ${size} px.`,
        );
        return;
      }
      const applicationCursorKeys = currentTab()?.controls?.applicationCursorMode() ?? false;
      sendInput(keySequence(key, applicationCursorKeys));
    },
    [sendInput, updateTerminalSettings, vault, toast, saveHostTerminal],
  );

  // Focus is the only handle a page has on the on-screen keyboard: the terminal
  // holding it is what keeps the keyboard up, and dropping it puts it away.
  const toggleKeyboard = useCallback(() => {
    const controls = currentTab()?.controls;
    if (!controls) return;
    if (morePanelOpen) {
      setMorePanelOpen(false);
      controls.focus();
    } else if (terminalFocused) controls.blur();
    else controls.focus();
  }, [terminalFocused, morePanelOpen]);

  // The panel takes the system keyboard's place, so opening it puts the keyboard
  // away and closing it with More keys brings it back if it was up.
  const changeMorePanel = useCallback(
    (open: boolean) => {
      setMorePanelOpen(open);
      const controls = currentTab()?.controls;
      if (open) {
        keyboardBeforePanelRef.current = terminalFocused;
        controls?.blur();
      } else if (keyboardBeforePanelRef.current) controls?.focus();
    },
    [terminalFocused],
  );

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
    return trackViewportHeight(viewport, document.documentElement, () =>
      setShortLandscape(isShortLandscape(viewport)),
    );
  }, []);

  // Only during a session: the connect form is a page that may need panning to
  // put a field above the keyboard, while the session fills the screen exactly
  // and any pan of it just slides the terminal away.
  useEffect(() => {
    if (!activeTab) return;
    return lockPageScroll(document);
  }, [activeTab]);

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
      port: values.port,
      username: values.username,
      target: `${values.username}@${hostPort}`,
      handle: null,
      controls: null,
      size: { ...terminalSizeRef.current },
      pendingData: [],
    };
    // A reconnect through the form may have changed the address.
    tab.host = values.host;
    tab.port = values.port;
    tab.username = values.username;
    tab.target = `${values.username}@${hostPort}`;
    tab.entryId = values.password.kind === "vault" ? values.password.entryId : undefined;
    tab.connecting = true;
    if (!retryTab) {
      tabsRef.current = [...tabsRef.current, tab];
      setTabs(tabsRef.current);
    }
    const reconnect = tab.reconnecting === true;
    const inPlace = reconnect && pendingReconnectRef.current !== tab.id;
    let markerPending = reconnect;
    const draw = (chunk: Uint8Array) => {
      if (tab.controls) tab.controls.write(chunk);
      else tab.pendingData.push(chunk);
    };
    const drawMarker = () => {
      if (!markerPending) return;
      markerPending = false;
      draw(RECONNECT_MARKER);
    };
    // A cancelled or superseded attempt's session is closed on arrival; its
    // callbacks must not touch the tab, which may be closed or reconnecting again.
    let opened = false;
    const stale = () => !opened && connectionAttemptRef.current !== attempt;
    let knownHosts = new Map<string, string>();

    try {
      knownHosts = await loadKnownHosts();
      const requested = requestedGraceMs(terminalSettings.keepAlive);
      let capabilities = capabilitiesRef.current;
      if (requested !== "v1" && capabilities === "unknown") {
        capabilities = await fetchRelayCapabilities(RELAY_WS_URL);
        capabilitiesRef.current = capabilities;
      }
      const resumable = requested !== "v1" && capabilities !== "unknown" && capabilities.resume;
      const handle = await connectSession({
        relayWsUrl: RELAY_WS_URL,
        host: values.host,
        port: values.port,
        username: values.username,
        password: values.password,
        ...(resumable ? { keepAliveMs: requested } : {}),
        isTrustedFingerprint: (fingerprint) => knownHosts.get(hostPort) === fingerprint,
        onData: (chunk) => {
          drawMarker();
          draw(chunk);
        },
        onClose: (reason) => {
          if (!tabsRef.current.includes(tab) || stale()) return;
          tab.lostWhileHidden =
            tab.lostWhileHidden || pageHiddenRef.current || document.visibilityState === "hidden";
          tab.transport = undefined;
          if (textViewRef.current === tab.id) {
            textViewRef.current = null;
            setTextView(null);
          }
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
          setSessionAnnouncement(`Terminal for ${tab.target} disconnected.`);
          // On touch the closed tab stays so its recovery row and output remain.
          if (touchPointer) {
            tab.lostReason = reason;
            setTabs([...tabsRef.current]);
          } else if (tabsRef.current.length === 1) {
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
        onTransportStatus: (transport, info) => {
          if (!tabsRef.current.includes(tab) || stale()) return;
          if (transport === "connected") {
            if (tab.transport === "resuming") setSessionAnnouncement("Back in session.");
            tab.transport = "connected";
            tab.grantedGraceMs = info?.grantedGraceMs;
            tab.lostWhileHidden = false;
          } else if (transport === "reconnecting") {
            setSessionAnnouncement("");
            tab.transport = "resuming";
          } else {
            tab.transport = undefined;
          }
          setTabs([...tabsRef.current]);
        },
      });
      if (connectionAttemptRef.current !== attempt || !tabsRef.current.includes(tab)) {
        handle.close();
        return;
      }
      opened = true;
      tab.handle = handle;
      tab.download = undefined;
      if (resumable && !tab.transport) tab.transport = "connected";
      tab.connecting = false;
      if (reconnect) {
        tab.reconnecting = false;
        tab.reconnectError = undefined;
        tab.lostReason = undefined;
        tab.lostWhileHidden = false;
        tab.inputError = undefined;
        drawMarker();
      }
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
        // The host-key prompt shows over the connect view, not over a session.
        if (inPlace && activeIdRef.current === tab.id) selectTab(null);
      } else if (reconnect) {
        // A failed reconnect leaves the closed tab and its output in place.
        if (values.password.kind === "key") values.password.privateKey.fill(0);
        const message = error instanceof Error ? error.message : String(error);
        tab.connecting = false;
        tab.reconnecting = false;
        if (inPlace) {
          tab.reconnectError = message;
          setStatus({ kind: "idle" });
          setTabs([...tabsRef.current]);
          if (activeIdRef.current !== tab.id) selectTab(tab.id, false);
        } else {
          setTabs([...tabsRef.current]);
          setStatus({ kind: "error", message });
        }
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

  /** One-tap Reconnect (S-16, S-17): the unlocked vault reconnects in place, anything else asks. */
  const reconnectTab = (tab: TerminalTab) => {
    tab.reconnectError = undefined;
    const entry =
      tab.entryId !== undefined && vault.status === "unlocked"
        ? vault.entries.find(
            (saved) =>
              saved.id === tab.entryId &&
              saved.hasPassword &&
              saved.host === tab.host &&
              saved.port === tab.port &&
              (saved.username ?? "") === tab.username,
          )
        : undefined;
    // Another attempt in flight owns the connection slot; the form waits for it.
    const busy = status.kind === "connecting" || status.kind === "unknown-host";
    if (entry && !busy) {
      setPendingReconnect(null);
      tab.reconnecting = true;
      setTabs([...tabsRef.current]);
      void attemptConnect(
        {
          host: tab.host,
          port: tab.port,
          username: tab.username,
          password: { kind: "vault", entryId: entry.id },
        },
        tab,
      );
      return;
    }
    selectTab(null);
    setPendingReconnect(tab.id);
  };

  const cancelReconnect = (tab: TerminalTab) => {
    connectionAttemptRef.current++;
    tab.connecting = false;
    tab.reconnecting = false;
    setTabs([...tabsRef.current]);
    setStatus({ kind: "idle" });
  };

  const submitConnect = (values: ConnectFormValues) => {
    const tab = tabsRef.current.find((entry) => entry.id === pendingReconnectRef.current);
    if (tab && !tab.handle) {
      tab.reconnecting = true;
      void attemptConnect(values, tab);
    } else {
      void attemptConnect(values);
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

  const savedEntryFor = (tab: TerminalTab | null) =>
    vault.status === "unlocked" && tab?.entryId
      ? vault.entries.find((entry) => entry.id === tab.entryId)
      : undefined;
  const settingsFor = (tab: TerminalTab | null) =>
    effectiveTerminalSettings(terminalSettings, savedEntryFor(tab), vault.status === "unlocked");
  const activeSettings = settingsFor(activeTab);
  useEffect(() => {
    void loadTerminalFont(activeSettings.fontFamily);
  }, [activeSettings.fontFamily]);
  const terminalTheme =
    TERMINAL_THEMES[terminalSettings.themeName] ?? TERMINAL_THEMES[DEFAULT_THEME_NAME] ?? {};

  const openTextView = (id: number) => {
    if (activeIdRef.current !== id) return;
    const controls = tabsRef.current.find((tab) => tab.id === id)?.controls;
    if (!controls) return;
    controls.blur();
    textViewRef.current = id;
    setTextView({ tabId: id, text: controls.snapshotText() });
  };

  const closeTextView = () => {
    textViewRef.current = null;
    setTextView(null);
  };

  const closeTab = (id: number) => {
    const tab = tabsRef.current.find((entry) => entry.id === id);
    if (!tab) return;
    if (textViewRef.current === id) closeTextView();
    if (pendingReconnectRef.current === id) setPendingReconnect(null);
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
    if (!switcherOpen) return;
    const onOutside = (event: PointerEvent) => {
      if (switcherButtonRef.current?.contains(event.target as Node)) return;
      if (!switcherRef.current?.contains(event.target as Node)) {
        setSwitcherOpen(false);
        switcherButtonRef.current?.focus();
      }
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSwitcherOpen(false);
      switcherButtonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [switcherOpen]);

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
      ? activeTab.transport === "resuming"
        ? "Resuming"
        : "Connected"
      : "Disconnected"
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
          onPaste={(text) => {
            if (textViewRef.current === null) currentTab()?.controls?.paste(text);
          }}
        />
      )}
      <button
        className="toolbar-button"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={settingsOpen}
        onClick={(event) => {
          settingsReturnFocusRef.current =
            activeTab && compactToolbar
              ? document.querySelector<HTMLElement>("[data-actions-trigger]")
              : event.currentTarget;
          afterAction();
          setSettingsOpen(true);
        }}
      >
        <Settings />
        <span className="toolbar-label">Settings</span>
      </button>
      <Help />
      <About />
    </>
  );

  const keyBar = activeTab?.handle && touchPointer && !textView && (
    <KeyBar
      disabled={activeTab.transport === "resuming"}
      keys={keyBarKeys}
      fontSize={activeSettings.fontSize}
      modifiers={modifiers}
      keyboardUp={terminalFocused}
      onToggleKeyboard={toggleKeyboard}
      onToggleModifier={toggleModifier}
      onKey={sendKey}
      morePanelOpen={morePanelOpen}
      onMorePanelOpenChange={changeMorePanel}
      onCapacityChange={setKeyBarCapacity}
    />
  );

  return (
    <LucideProvider size={18} strokeWidth={2} className="icon">
      <HelpProvider>
        <SettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          value={terminalSettings}
          onChange={updateTerminalSettings}
          savedEntry={savedEntryFor(activeTab)}
          hasSavedHost={!!activeTab?.entryId}
          vaultUnlocked={vault.status === "unlocked"}
          onSaveHost={async (terminal: TerminalPrefs | null) => {
            const entry = savedEntryFor(activeTab);
            if (!entry) return false;
            return saveHostTerminal(entry, terminal);
          }}
          activeTarget={activeTab?.target}
          hasOpenTerminals={tabs.length > 0}
          relayWsUrl={RELAY_WS_URL}
          touchPointer={touchPointer}
          keyBarCapacity={keyBarCapacity}
          returnFocusTo={() => settingsReturnFocusRef.current}
        />
        <main
          className={activeTab ? "app-shell app-shell--session" : "app-shell app-shell--connect"}
        >
          <header
            className={
              combinedRow && activeTab ? "app-toolbar app-toolbar--combined" : "app-toolbar"
            }
          >
            <span className="visually-hidden" aria-live="polite">
              {sessionAnnouncement}
            </span>
            <span className="toolbar-brand">localssh</span>
            {activeTab && phoneScreen ? (
              <button
                ref={switcherButtonRef}
                className="session-identity session-identity--switcher"
                type="button"
                aria-label={
                  combinedRow
                    ? `Open terminals, ${activeTab.target}, ${connectionLabel}`
                    : "Open terminals"
                }
                aria-expanded={switcherOpen}
                aria-controls="phone-terminals"
                onClick={() => setSwitcherOpen((open) => !open)}
              >
                <span className="connection-status">
                  {activeTab.handle
                    ? activeTab.transport === "resuming"
                      ? "Resuming"
                      : "Connected"
                    : "Disconnected"}
                </span>
                {combinedRow ? (
                  <span className="active-target active-target--middle" aria-hidden="true">
                    <span>{activeTab.target.slice(0, Math.ceil(activeTab.target.length / 2))}</span>
                    <span>{activeTab.target.slice(Math.ceil(activeTab.target.length / 2))}</span>
                  </span>
                ) : (
                  <span className="active-target">{activeTab.target}</span>
                )}
                <ChevronDown aria-hidden="true" />
              </button>
            ) : (
              <div className="session-identity">
                <span className="connection-status" aria-live="polite">
                  {connectionLabel}
                </span>
                {activeTab && <span className="active-target">{activeTab.target}</span>}
              </div>
            )}
            {keyBar && combinedRow && keyBar}
            {activeTab && (compactToolbar || combinedRow) ? (
              <ActionsMenu>{(close) => toolbarControls(close)}</ActionsMenu>
            ) : (
              <div className="toolbar-actions">{toolbarControls()}</div>
            )}
          </header>

          {tabs.length > 0 && (!activeTab || !phoneScreen || switcherOpen) && (
            <div
              className={`terminal-tabs${activeTab && phoneScreen ? " terminal-tabs--switcher" : ""}`}
              role="tablist"
              aria-label="Open terminals"
              id={activeTab && phoneScreen ? "phone-terminals" : undefined}
              ref={switcherRef}
            >
              {activeTab && phoneScreen && (
                <div className="terminal-tabs__heading">
                  <span>Open terminals</span>
                  <button
                    type="button"
                    onClick={() => {
                      setSwitcherOpen(false);
                      switcherButtonRef.current?.focus();
                    }}
                  >
                    Close
                  </button>
                </div>
              )}
              {tabs.map((tab) => (
                <div className="terminal-tabs__item" key={tab.id}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeId === tab.id}
                    aria-controls={`terminal-panel-${tab.id}`}
                    aria-label={`${tab.host}, ${tab.handle ? (tab.transport === "resuming" ? "resuming" : "connected") : tab.connecting ? "connecting" : "disconnected"}`}
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
                    {phoneScreen && <span className="terminal-tabs__target">{tab.target}</span>}
                    {phoneScreen && (tab.handle || tab.connecting) && (
                      <span className="terminal-tabs__phone-state">
                        {tab.handle
                          ? tab.transport === "resuming"
                            ? "Resuming"
                            : "Connected"
                          : "Connecting"}
                      </span>
                    )}
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
                  setPendingReconnect(null);
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
                  key={pendingReconnectId ?? "new"}
                  initialValues={(() => {
                    const tab = tabs.find((entry) => entry.id === pendingReconnectId);
                    return tab && { host: tab.host, port: tab.port, username: tab.username };
                  })()}
                  vault={vault}
                  onConnect={submitConnect}
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
                    lineHeight={terminalSettings.lineHeight}
                    theme={terminalTheme}
                    active={false}
                    phoneScreen={phoneScreen}
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
                      focusPendingTerminal(tab.id);
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
                    onSelectText={() => openTextView(tab.id)}
                    onResize={(cols, rows) => {
                      tab.size = { cols, rows };
                      tab.handle?.resize(cols, rows);
                    }}
                    fontSize={settingsFor(tab).fontSize}
                    fontFamily={settingsFor(tab).fontFamily}
                    lineHeight={settingsFor(tab).lineHeight}
                    theme={
                      TERMINAL_THEMES[settingsFor(tab).themeName] ??
                      TERMINAL_THEMES[DEFAULT_THEME_NAME] ??
                      {}
                    }
                    active={activeId === tab.id && !!tab.handle && textView?.tabId !== tab.id}
                    phoneScreen={phoneScreen}
                  />
                  {touchPointer && activeId === tab.id && !textView && (
                    <button
                      className="terminal-select-button"
                      type="button"
                      onClick={() => openTextView(tab.id)}
                    >
                      Select text
                    </button>
                  )}
                  {textView?.tabId === tab.id && (
                    <div className="terminal-text-view" role="dialog" aria-label="Select text">
                      <button type="button" onClick={closeTextView} aria-label="Close text view">
                        Close
                      </button>
                      <pre>{textView.text}</pre>
                    </div>
                  )}
                </div>
                {fileTabs.has(tab.id) && tab.handle && (
                  <FilePanel
                    handle={tab.handle}
                    transport={tab.transport === "resuming" ? "resuming" : "connected"}
                    identity={{ host: tab.host, port: tab.port, username: tab.username }}
                    onDownloadStop={(info) => recordDownload(tab, info)}
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
          {activeTab &&
            touchPointer &&
            !textView &&
            (activeTab.handle ? (
              !combinedRow && keyBar
            ) : (
              <RecoveryRow
                cause={
                  activeTab.lostWhileHidden
                    ? "background"
                    : activeTab.lostReason
                      ? "network"
                      : "server"
                }
                stoppedDownload={activeTab.download}
                onReconnect={() => reconnectTab(activeTab)}
                onClose={() => closeTab(activeTab.id)}
                connectingTo={activeTab.connecting ? activeTab.host : undefined}
                onCancel={() => cancelReconnect(activeTab)}
                error={
                  activeTab.reconnectError ? (
                    <ConnectionError raw={activeTab.reconnectError} />
                  ) : undefined
                }
              />
            ))}

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
                const reconnecting = tabsRef.current.find(
                  (tab) => tab.id === status.tabId && tab.reconnecting,
                );
                if (reconnecting) {
                  // Declining the key leaves the closed tab as it was (S-15).
                  reconnecting.connecting = false;
                  reconnecting.reconnecting = false;
                  setTabs([...tabsRef.current]);
                  setStatus({ kind: "idle" });
                  if (pendingReconnectRef.current !== reconnecting.id) selectTab(reconnecting.id);
                  return;
                }
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
