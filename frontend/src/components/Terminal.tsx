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
}

export interface TerminalProps {
  onReady: (controls: TerminalControls) => void;
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  fontSize: number;
  fontFamily: string;
  theme: ITheme;
  active: boolean;
}

export function Terminal({
  onReady,
  onInput,
  onResize,
  fontSize,
  fontFamily,
  theme,
  active,
}: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const previousFontSizeRef = useRef(fontSize);

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
      lineHeight: 1.15,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    if (term.textarea) term.textarea.tabIndex = active ? 0 : -1;
    termRef.current = term;
    fitRef.current = fit;

    const dataSubscription = term.onData(onInput);
    const resizeSubscription = term.onResize(({ cols, rows }) => onResize(cols, rows));
    onReady({
      write: (data) => term.write(data),
      reset: () => term.reset(),
      focus: () => term.focus(),
      blur: () => term.blur(),
      applicationCursorMode: () => isApplicationCursorMode(term),
    });

    let animationFrame = 0;
    const fitTerminal = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        if (containerRef.current?.clientWidth && containerRef.current.clientHeight) {
          fit.fit();
        }
      });
    };

    const observer = new ResizeObserver(fitTerminal);
    observer.observe(containerRef.current);
    window.visualViewport?.addEventListener("resize", fitTerminal);
    void document.fonts.ready.then(fitTerminal);
    fitTerminal();

    const detachGestures = attachGestures(containerRef.current, {
      term,
      onInput,
      smallScreenIOS: isSmallScreenIOS(currentIOSDevice()),
    });

    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      window.visualViewport?.removeEventListener("resize", fitTerminal);
      detachGestures();
      dataSubscription.dispose();
      resizeSubscription.dispose();
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

    const fitAndRefresh = () => {
      fitRef.current?.fit();
      const currentTerm = termRef.current;
      if (currentTerm) currentTerm.refresh(0, currentTerm.rows - 1);
    };

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

    return () => {
      cancelRestore();
      cancelAnimationFrame(fitFrame);
    };
  }, [fontSize, fontFamily]);

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
      className="terminal"
      ref={containerRef}
      style={{ "--terminal-background": theme.background } as CSSProperties}
    />
  );
}

interface GestureTargets {
  term: XTerm;
  onInput: (data: string) => void;
  smallScreenIOS: boolean;
}

/**
 * Recognises the touch gestures a phone or tablet needs to drive a shell:
 * swipe right for Tab, left for Esc, and flick up or down for shell history.
 * Pointer events cover touch and pen without claiming the mouse, and nothing
 * here calls preventDefault on a scroll, so xterm keeps its own touch scrolling
 * and text selection.
 *
 * A tap focuses the terminal from inside the pointerup handler. Safari opens the
 * on-screen keyboard only for a focus() made during a user gesture, and xterm's
 * own focus happens in a synthesised mousedown, which is a weaker claim to that
 * gesture; focusing here makes a tap raise the keyboard on iOS.
 */
function attachGestures(element: HTMLElement, targets: GestureTargets): () => void {
  const active = new Map<number, { x: number; y: number }>();
  let start: {
    x: number;
    y: number;
    at: number;
    verticalHistoryAllowed: boolean;
  } | null = null;
  let multiTouch = false;
  let twoFingerY: number | null = null;
  let twoFingerRemainder = 0;

  const activeCentroidY = () => {
    let total = 0;
    for (const point of active.values()) total += point.y;
    return total / active.size;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "mouse") return;
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
    } else {
      // A second finger explicitly drives scrollback, never shell input.
      start = null;
      multiTouch = true;
      if (active.size === 2) {
        twoFingerY = activeCentroidY();
        twoFingerRemainder = 0;
      }
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!active.has(event.pointerId)) return;
    active.set(event.pointerId, { x: event.clientX, y: event.clientY });
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

    if (multiTouch) {
      if (active.size < 2) {
        twoFingerY = null;
        twoFingerRemainder = 0;
      }
      if (active.size === 0) multiTouch = false;
      return;
    }
    if (!start || active.size > 0) return;

    const sample = {
      dx: event.clientX - start.x,
      dy: event.clientY - start.y,
      dt: event.timeStamp - start.at,
      atBottom: isViewportAtBottom(targets.term),
      verticalHistoryAllowed: start.verticalHistoryAllowed,
    };
    start = null;

    const gesture = classifyGesture(sample);
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
