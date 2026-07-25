import { useEffect, useRef, type CSSProperties } from "react";
import { Terminal as XTerm, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { classifyGesture, gestureToInput, pinchFontSize } from "../terminalGestures.js";
import "@xterm/xterm/css/xterm.css";

export interface TerminalControls {
  write: (data: Uint8Array) => void;
  /** Wipes the screen and scrollback so no session leaks into the next one. */
  reset: () => void;
  focus: () => void;
}

export interface TerminalProps {
  onReady: (controls: TerminalControls) => void;
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  onFontSizeChange: (fontSize: number) => void;
  fontSize: number;
  fontFamily: string;
  theme: ITheme;
  active: boolean;
}

export function Terminal({
  onReady,
  onInput,
  onResize,
  onFontSizeChange,
  fontSize,
  fontFamily,
  theme,
  active,
}: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // Read inside listeners that are attached once, so they never go stale.
  const fontSizeRef = useRef(fontSize);
  const onFontSizeChangeRef = useRef(onFontSizeChange);

  useEffect(() => {
    fontSizeRef.current = fontSize;
    onFontSizeChangeRef.current = onFontSizeChange;
  }, [fontSize, onFontSizeChange]);

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
      getFontSize: () => fontSizeRef.current,
      setFontSize: (next) => onFontSizeChangeRef.current(next),
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
    termRef.current.options.fontSize = fontSize;
    termRef.current.options.fontFamily = fontFamily;
    requestAnimationFrame(() => fitRef.current?.fit());
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
  getFontSize: () => number;
  setFontSize: (next: number) => void;
}

/**
 * Recognises the touch gestures a phone or tablet needs to drive a shell:
 * swipe right for Tab, left for Esc, flick up or down for shell history, and
 * pinch to size the text. Pointer events cover touch and pen without claiming
 * the mouse, and nothing here calls preventDefault on a scroll, so xterm keeps
 * its own touch scrolling and text selection.
 */
function attachGestures(element: HTMLElement, targets: GestureTargets): () => void {
  const active = new Map<number, { x: number; y: number }>();
  let start: { x: number; y: number; at: number } | null = null;
  let pinchStartDistance = 0;
  let pinchBaseFontSize = 0;

  const distance = () => {
    const [a, b] = [...active.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "mouse") return;
    active.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (active.size === 1) {
      start = { x: event.clientX, y: event.clientY, at: event.timeStamp };
    } else if (active.size === 2) {
      start = null; // a second finger means this is a pinch, not a swipe
      pinchStartDistance = distance();
      pinchBaseFontSize = targets.getFontSize();
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!active.has(event.pointerId)) return;
    active.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (active.size !== 2 || pinchStartDistance <= 0) return;
    const current = distance();
    if (current <= 0) return;

    const next = pinchFontSize(pinchBaseFontSize, current / pinchStartDistance);
    if (next !== targets.getFontSize()) targets.setFontSize(next);
  };

  const onPointerEnd = (event: PointerEvent) => {
    if (!active.has(event.pointerId)) return;
    const wasPinching = active.size === 2;
    active.delete(event.pointerId);

    if (wasPinching) {
      pinchStartDistance = 0;
      start = null;
      return;
    }
    if (!start || active.size > 0) return;

    const gesture = classifyGesture({
      dx: event.clientX - start.x,
      dy: event.clientY - start.y,
      dt: event.timeStamp - start.at,
      atBottom: isViewportAtBottom(targets.term),
    });
    start = null;
    if (gesture) targets.onInput(gestureToInput(gesture, isApplicationCursorMode(targets.term)));
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
