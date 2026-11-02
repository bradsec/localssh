import { useEffect, useRef, type CSSProperties } from "react";
import { Terminal as XTerm, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import {
  classifyGesture,
  gestureToInput,
  isTap,
  twoFingerScrollLines,
} from "../terminalGestures.js";
import {
  applyFontOptions,
  applyFontOptionsAcrossFrames,
  isSmallScreenIOS,
  type IOSDevice,
} from "../terminalFont.js";
import { resizeKeepingSelection } from "../terminalSelection.js";
import { snapshotTerminalText } from "../terminalSnapshot.js";
import { loadTerminalFont } from "../terminalFonts.js";
import {
  attachTouchTextLayer,
  pasteTerminalText,
  selectWordAt,
  type TouchTextLayer,
} from "../terminalTouch.js";
import "@xterm/xterm/css/xterm.css";

export interface TerminalControls {
  write: (data: Uint8Array) => void;
  /** Wipes the screen and scrollback so no session leaks into the next one. */
  reset: () => void;
  focus: () => void;
  /** Drops focus, which is what dismisses a phone's on-screen keyboard. */
  blur: () => void;
  /** Whether cursor keys currently take their application encoding. */
  applicationCursorMode: () => boolean;
  /** The text the user has selected in the terminal, empty when none. */
  getSelection: () => string;
  /** Captures the active terminal buffer for a read-only text view. */
  snapshotText: () => string;
  /** Inserts text as if pasted, honouring the terminal's bracketed-paste mode. */
  paste: (text: string) => void;
}

export interface TerminalProps {
  onReady: (controls: TerminalControls) => void;
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  /** Reports terminal focus, which on a phone is the on-screen keyboard being up. */
  onFocusChange?: (focused: boolean) => void;
  /** Reports whether the terminal currently holds a text selection. */
  onSelectionChange?: (hasSelection: boolean) => void;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  theme: ITheme;
  active: boolean;
  phoneScreen: boolean;
}

export function Terminal({
  onReady,
  onInput,
  onResize,
  onFocusChange,
  onSelectionChange,
  fontSize,
  fontFamily,
  lineHeight,
  theme,
  active,
  phoneScreen,
}: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const previousFontSizeRef = useRef(fontSize);
  const phoneScreenRef = useRef(phoneScreen);
  phoneScreenRef.current = phoneScreen;
  // The terminal is built once, so the setup effect reads the current callback
  // through a ref rather than closing over the one it was mounted with.
  const onFocusChangeRef = useRef(onFocusChange);
  onFocusChangeRef.current = onFocusChange;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;

  // xterm does not announce a selection restored after a resize, because its
  // change detection never saw the resize clear it, so the state is reported
  // directly after every fit.
  const fitKeepingSelection = (term: XTerm, fit: FitAddon) => {
    resizeKeepingSelection(term, () => fit.fit());
    onSelectionChangeRef.current?.(term.hasSelection());
  };

  const fitAndRefresh = () => {
    const currentTerm = termRef.current;
    const currentFit = fitRef.current;
    if (!currentTerm || !currentFit) return;
    fitKeepingSelection(currentTerm, currentFit);
    currentTerm.refresh(0, currentTerm.rows - 1);
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      fontSize,
      fontFamily,
      theme,
      disableStdin: !active,
      minimumContrastRatio: 4.5,
      screenReaderMode: true,
      scrollback: 5_000,
      lineHeight,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    if (term.textarea) term.textarea.tabIndex = active ? 0 : -1;
    termRef.current = term;
    fitRef.current = fit;

    const dataSubscription = term.onData(onInput);
    const resizeSubscription = term.onResize(({ cols, rows }) => onResize(cols, rows));
    const selectionSubscription = term.onSelectionChange(() =>
      onSelectionChangeRef.current?.(term.hasSelection()),
    );
    onReady({
      write: (data) => term.write(data),
      reset: () => term.reset(),
      focus: () => term.focus(),
      blur: () => term.blur(),
      applicationCursorMode: () => isApplicationCursorMode(term),
      getSelection: () => term.getSelection(),
      snapshotText: () => snapshotTerminalText(term.buffer.active),
      paste: (text) => term.paste(text),
    });

    // The hidden textarea is the element that holds focus, and on a phone the
    // on-screen keyboard follows it.
    const textarea = term.textarea;
    const reportFocus = () => onFocusChangeRef.current?.(true);
    const reportBlur = () => onFocusChangeRef.current?.(false);
    textarea?.addEventListener("focus", reportFocus);
    textarea?.addEventListener("blur", reportBlur);

    let animationFrame = 0;
    const fitTerminal = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        if (containerRef.current?.clientWidth && containerRef.current.clientHeight) {
          fitKeepingSelection(term, fit);
        }
      });
    };

    const observer = new ResizeObserver(fitTerminal);
    observer.observe(containerRef.current);
    window.visualViewport?.addEventListener("resize", fitTerminal);
    void document.fonts.ready.then(fitTerminal);
    fitTerminal();

    // A touch device gets a selectable copy of the visible rows and an editable
    // field under the finger, so its own long-press Copy and Paste callouts work
    // on the live terminal. Mouse devices keep xterm's own selection.
    const touchHost = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    const textLayer = touchHost ? attachTouchTextLayer(term) : null;
    const host = containerRef.current;
    const pasteInto = (event: Event) =>
      pasteTerminalText(event as ClipboardEvent, term.paste.bind(term));
    if (textLayer) {
      host.classList.add("terminal-host--touch");
      // Capture phase, so xterm's own paste listener on the textarea does not
      // also send the text.
      host.addEventListener("paste", pasteInto, true);
    }

    const detachGestures = attachGestures(host, {
      term,
      onInput,
      isPhoneScreen: () => phoneScreenRef.current,
      smallScreenIOS: isSmallScreenIOS(currentIOSDevice()),
      textLayer,
    });

    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      window.visualViewport?.removeEventListener("resize", fitTerminal);
      textarea?.removeEventListener("focus", reportFocus);
      textarea?.removeEventListener("blur", reportBlur);
      detachGestures();
      if (textLayer) {
        host.removeEventListener("paste", pasteInto, true);
        host.classList.remove("terminal-host--touch");
        textLayer.dispose();
      }
      dataSubscription.dispose();
      resizeSubscription.dispose();
      selectionSubscription.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // The terminal must be constructed once. Live option updates are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!termRef.current) return;
    const term = termRef.current;
    const sizeChanged = previousFontSizeRef.current !== fontSize;
    previousFontSizeRef.current = fontSize;
    const device = currentIOSDevice();

    let cancelRestore = () => {};
    let fitFrame = 0;
    if (sizeChanged && isSmallScreenIOS(device)) {
      // Mobile Safari can coalesce two family writes in the same turn. Keeping
      // the temporary family through a rendered frame reproduces the manual font
      // switch that makes it discard the stale character-cell measurement.
      cancelRestore = applyFontOptionsAcrossFrames(term, fontSize, fontFamily, fitAndRefresh);
    } else {
      applyFontOptions(term, fontSize, fontFamily);
      fitFrame = requestAnimationFrame(fitAndRefresh);
    }

    let cancelled = false;
    const remeasureLoadedFont = () => {
      if (cancelled) return;
      if (isSmallScreenIOS(device)) {
        cancelRestore();
        cancelRestore = applyFontOptionsAcrossFrames(term, fontSize, fontFamily, fitAndRefresh);
      } else {
        applyFontOptions(term, fontSize, fontFamily);
        fitAndRefresh();
      }
    };
    void loadTerminalFont(fontFamily)
      .then(() => document.fonts.load(`${fontSize}px ${fontFamily}`))
      .then(remeasureLoadedFont)
      .catch((error: unknown) => console.error("Terminal font failed to load", error));

    return () => {
      cancelled = true;
      cancelRestore();
      cancelAnimationFrame(fitFrame);
    };
  }, [fontSize, fontFamily]);

  useEffect(() => {
    if (!termRef.current || termRef.current.options.lineHeight === lineHeight) return;
    termRef.current.options.lineHeight = lineHeight;
    const fitFrame = requestAnimationFrame(fitAndRefresh);
    return () => cancelAnimationFrame(fitFrame);
    // fitAndRefresh reads only refs, so it need not be a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineHeight]);

  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.disableStdin = !active;
    if (termRef.current.textarea) termRef.current.textarea.tabIndex = active ? 0 : -1;
  }, [active]);

  return (
    <div
      className="terminal-host"
      ref={containerRef}
      style={
        {
          "--terminal-background": theme.background,
          "--terminal-scrollbar": theme.foreground,
        } as CSSProperties
      }
    />
  );
}

interface GestureTargets {
  term: XTerm;
  onInput: (data: string) => void;
  isPhoneScreen: () => boolean;
  smallScreenIOS: boolean;
  /** Present on touch devices: the selectable copy of the visible rows. */
  textLayer: TouchTextLayer | null;
}

/**
 * Recognises tablet touch gestures for shell keys; phone drags only scroll.
 * Pointer events cover touch and pen without claiming the mouse. A long press
 * belongs to the browser: it selects text in the selectable copy of the rows or
 * shows Paste on the editable field beneath them. While such a selection exists
 * every gesture here stands down, so nothing reaches the shell.
 *
 * A tap focuses the terminal from inside the pointerup handler. Safari opens the
 * on-screen keyboard only for a focus() made during a user gesture, and xterm's
 * own focus happens in a synthesised mousedown, which is a weaker claim to that
 * gesture; focusing here makes a tap raise the keyboard on iOS.
 */
const LONG_PRESS_MS = 600;

function attachGestures(element: HTMLElement, targets: GestureTargets): () => void {
  const isPhoneScreen = targets.isPhoneScreen;
  const active = new Map<number, { x: number; y: number }>();
  let start: {
    x: number;
    y: number;
    at: number;
    verticalHistoryAllowed: boolean;
  } | null = null;
  let multiTouch = false;
  // Set once a single-touch swipe has been recognised so the rest of that touch
  // fires nothing further and the release is not mistaken for a tap.
  let handled = false;
  let twoFingerY: number | null = null;
  let twoFingerRemainder = 0;
  let oneFingerY: number | null = null;
  let oneFingerRemainder = 0;
  let longPressTimer = 0;

  const cancelLongPress = () => {
    window.clearTimeout(longPressTimer);
    longPressTimer = 0;
  };

  // Recognises the swipe from the movement so far rather than waiting for the
  // release. This lets a history flick win before the same movement becomes
  // manual scrollback below.
  const recogniseInFlight = (event: PointerEvent) => {
    if (isPhoneScreen() || multiTouch || handled || !start || active.size !== 1) return;
    const gesture = classifyGesture({
      dx: event.clientX - start.x,
      dy: event.clientY - start.y,
      dt: event.timeStamp - start.at,
      atBottom: isViewportAtBottom(targets.term),
      verticalHistoryAllowed: start.verticalHistoryAllowed,
    });
    if (!gesture) return;
    handled = true;
    targets.onInput(gestureToInput(gesture, isApplicationCursorMode(targets.term)));
  };

  const activeCentroidY = () => {
    let total = 0;
    for (const point of active.values()) total += point.y;
    return total / active.size;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "mouse") return;
    // Let the browser keep or dismiss its selection; no swipe, scroll, or tap.
    if (targets.textLayer?.hasSelection()) return;

    // A touch on the selectable text or the input field belongs to Safari's own
    // long press (selection and Copy, or Paste); preventing it would stop that.
    // Elsewhere, keep Safari from turning a long press into page movement or its
    // callout, and capture so a drag stays alive when a thumb strays outside.
    const target = event.target instanceof Element ? event.target : null;
    const onField = !!target?.closest(".xterm-helper-textarea");
    const nativeTouch =
      !!targets.textLayer && (onField || !!target?.closest(".terminal-touch-text"));
    if (!nativeTouch) {
      event.preventDefault();
      element.setPointerCapture?.(event.pointerId);
    }
    active.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (active.size === 1) {
      const bounds = element.getBoundingClientRect();
      const startsNearPrompt = event.clientY >= bounds.top + bounds.height * 0.75;
      start = {
        x: event.clientX,
        y: event.clientY,
        at: event.timeStamp,
        verticalHistoryAllowed: !targets.smallScreenIOS || startsNearPrompt,
      };
      multiTouch = false;
      handled = false;
      oneFingerY = event.clientY;
      oneFingerRemainder = 0;
      cancelLongPress();
      const { clientX, clientY } = event;
      longPressTimer = window.setTimeout(() => {
        const layer = targets.textLayer;
        // The prompt row is the input field, kept for Paste.
        if (!layer || onField) return;
        handled = true;
        // Touch Safari selects by itself first; select the word only when it did not.
        if (!layer.hasSelection()) selectWordAt(layer.mirror, clientX, clientY);
      }, LONG_PRESS_MS);
    } else {
      // A second finger explicitly drives scrollback, never shell input.
      start = null;
      multiTouch = true;
      cancelLongPress();
      if (active.size === 2) {
        twoFingerY = activeCentroidY();
        twoFingerRemainder = 0;
      }
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!active.has(event.pointerId)) return;
    active.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (targets.textLayer?.hasSelection()) return;

    if (start && !isTap({ dx: event.clientX - start.x, dy: event.clientY - start.y })) {
      cancelLongPress();
    }
    recogniseInFlight(event);
    if (!multiTouch && active.size === 1 && oneFingerY !== null && !handled && start) {
      oneFingerRemainder += event.clientY - oneFingerY;
      oneFingerY = event.clientY;
      const canScrollNow =
        (isPhoneScreen() &&
          Math.abs(event.clientY - start.y) > Math.abs(event.clientX - start.x)) ||
        !isViewportAtBottom(targets.term) ||
        !start.verticalHistoryAllowed ||
        Math.abs(event.clientY - start.y) >= 44 ||
        event.timeStamp - start.at > 450;
      if (canScrollNow) {
        const rowHeight = element.clientHeight / targets.term.rows;
        const lines = twoFingerScrollLines(oneFingerRemainder, rowHeight);
        if (lines !== 0) {
          targets.term.scrollLines(lines);
          oneFingerRemainder += lines * rowHeight;
        }
      }
      event.preventDefault();
      return;
    }
    if (!multiTouch || active.size !== 2 || twoFingerY === null) return;

    const nextY = activeCentroidY();
    twoFingerRemainder += nextY - twoFingerY;
    twoFingerY = nextY;
    const rowHeight = element.clientHeight / targets.term.rows;
    const lines = twoFingerScrollLines(twoFingerRemainder, rowHeight);
    if (lines !== 0) {
      targets.term.scrollLines(lines);
      twoFingerRemainder += lines * rowHeight;
    }
    event.preventDefault();
  };

  const onPointerEnd = (event: PointerEvent) => {
    if (!active.has(event.pointerId)) return;
    active.delete(event.pointerId);
    if (element.hasPointerCapture?.(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
    cancelLongPress();

    // The browser took the touch over, so it completes nothing: no swipe, tap,
    // or selection change comes from where it happened to stop.
    if (event.type === "pointercancel") {
      start = null;
      oneFingerY = null;
      oneFingerRemainder = 0;
      if (active.size < 2) {
        twoFingerY = null;
        twoFingerRemainder = 0;
      }
      if (active.size === 0) {
        multiTouch = false;
        handled = false;
      }
      return;
    }

    if (multiTouch) {
      if (active.size < 2) {
        twoFingerY = null;
        twoFingerRemainder = 0;
      }
      if (active.size === 0) multiTouch = false;
      return;
    }

    // The swipe already fired from the movement; the release closes it out.
    if (handled) {
      if (active.size === 0) {
        start = null;
        handled = false;
      }
      return;
    }

    if (!start || active.size > 0) return;
    if (targets.textLayer?.hasSelection()) {
      start = null;
      return;
    }

    const sample = {
      dx: event.clientX - start.x,
      dy: event.clientY - start.y,
      dt: event.timeStamp - start.at,
      atBottom: isViewportAtBottom(targets.term),
      verticalHistoryAllowed: start.verticalHistoryAllowed,
    };
    start = null;

    const gesture = isPhoneScreen() ? null : classifyGesture(sample);
    if (gesture) {
      targets.onInput(gestureToInput(gesture, isApplicationCursorMode(targets.term)));
      return;
    }
    if (isTap(sample)) targets.term.focus();
  };

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", onPointerEnd);
  element.addEventListener("pointercancel", onPointerEnd);

  return () => {
    cancelLongPress();
    element.removeEventListener("pointerdown", onPointerDown);
    element.removeEventListener("pointermove", onPointerMove);
    element.removeEventListener("pointerup", onPointerEnd);
    element.removeEventListener("pointercancel", onPointerEnd);
  };
}

function isViewportAtBottom(term: XTerm): boolean {
  return term.buffer.active.viewportY >= term.buffer.active.baseY;
}

function isApplicationCursorMode(term: XTerm): boolean {
  return term.modes.applicationCursorKeysMode;
}

function currentIOSDevice(): IOSDevice {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
  };
}
