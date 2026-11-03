import { useEffect, useRef, type CSSProperties } from "react";
import { Terminal as XTerm, type IMarker, type ITheme } from "@xterm/xterm";
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
import { loadTerminalFont } from "../terminalFonts.js";
import {
  attachTouchTextLayer,
  bufferRange,
  recordTypedText,
  selectionEditBytes,
  syncVisibleRows,
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
  /** Inserts text as if pasted, honouring the terminal's bracketed-paste mode. */
  paste: (text: string) => void;
  /**
   * Reports bytes that reached the session from any source (typing, key bar,
   * paste), so touch selection edits know the current command's sent text.
   */
  noteSentInput: (data: string) => void;
}

export interface TerminalProps {
  onReady: (controls: TerminalControls) => void;
  /**
   * Bytes for the session. `raw` marks bytes the terminal generated to replay a
   * touch selection edit, which armed key bar modifiers must not change.
   */
  onInput: (data: string, raw?: boolean) => void;
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
  const activeRef = useRef(active);
  activeRef.current = active;
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

    let rawInput = false;
    const dataSubscription = term.onData((data) => onInput(data, rawInput));
    const sendRaw = (bytes: string) => {
      rawInput = true;
      try {
        term.input(bytes);
      } finally {
        rawInput = false;
      }
    };
    let lastCols = term.cols;
    const resizeSubscription = term.onResize(({ cols, rows }) => {
      // Reflow moves the command to other cells; the tracked columns no longer hold.
      if (cols !== lastCols) clearInputStart();
      lastCols = cols;
      onResize(cols, rows);
    });
    const selectionSubscription = term.onSelectionChange(() =>
      onSelectionChangeRef.current?.(term.hasSelection()),
    );
    let editableMirror: HTMLElement | null = null;
    // Markers keep the input row right when scrollback is trimmed.
    type CursorMark = { marker: IMarker; col: number };
    let inputStart: CursorMark | null = null;
    let recordedText: string | null = "";
    const markCursor = (): CursorMark => ({
      marker: term.registerMarker(0),
      col: term.buffer.active.cursorX,
    });
    const pointOf = (mark: CursorMark | null) =>
      mark && !mark.marker.isDisposed ? { row: mark.marker.line, col: mark.col } : null;
    function clearInputStart() {
      inputStart?.marker.dispose();
      inputStart = null;
      recordedText = "";
    }
    let lastSentAt = Number.NEGATIVE_INFINITY;
    let pasteText = (text: string) => term.paste(text);
    const readyControls: TerminalControls = {
      write: (data) => term.write(data),
      reset: () => term.reset(),
      focus: () => {
        if (editableMirror) {
          editableMirror.setAttribute("inputmode", "text");
          editableMirror.focus();
          onFocusChangeRef.current?.(true);
        } else term.focus();
      },
      blur: () => {
        if (editableMirror) {
          editableMirror.setAttribute("inputmode", "none");
          editableMirror.blur();
          onFocusChangeRef.current?.(false);
        } else term.blur();
      },
      applicationCursorMode: () => isApplicationCursorMode(term),
      getSelection: () => term.getSelection(),
      paste: (text) => pasteText(text),
      noteSentInput: (data) => {
        lastSentAt = performance.now();
        if (["\r", "\x03", "\x04", "\x15"].includes(data)) {
          clearInputStart();
          return;
        }
        const next = recordTypedText(recordedText, data);
        if (!inputStart && next && term.buffer.active.type === "normal") {
          inputStart = markCursor();
        }
        recordedText = next;
      },
    };
    // Output nobody asked for (a background job, a new prompt) may move or
    // replace the command line, so the tracked input start no longer holds.
    // Echo and completion output follow input well within this window.
    const writeSubscription = term.onWriteParsed(() => {
      if (performance.now() - lastSentAt > UNPROMPTED_OUTPUT_MS) clearInputStart();
    });
    const bufferSubscription = term.buffer.onBufferChange(clearInputStart);

    // Desktop uses xterm's textarea; touch uses the editable mirror for focus.
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

    // A touch device gets one editable, selectable copy of the visible rows, so
    // its own selection, Copy, and Paste work on the live terminal. Mouse devices
    // keep xterm's own selection and textarea.
    const touchHost = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    const textLayer = touchHost ? attachTouchTextLayer(term) : null;
    editableMirror = textLayer?.mirror ?? null;
    const host = containerRef.current;
    const mirror = editableMirror;
    // The bytes that delete `range` through the line editor, or null when it is
    // not certainly inside the current command input (see selectionEditBytes).
    const editFor = (range: AbstractRange | undefined): string | null => {
      const top = textLayer?.rowsTop();
      if (!textLayer || !range || top === null || top === undefined) return null;
      const span = bufferRange(term, textLayer.rows, top, range);
      return span
        ? selectionEditBytes(
            term,
            pointOf(inputStart),
            span.start,
            span.end,
            isApplicationCursorMode(term),
            recordedText,
          )
        : null;
    };
    const selectionEdit = () => {
      const selection = document.getSelection();
      return selection?.rangeCount ? editFor(selection.getRangeAt(0)) : null;
    };
    if (textLayer) {
      // Pasting over selected command input replaces it. Any selection is then
      // dropped, because the frozen copy would otherwise sit over new output.
      pasteText = (text) => {
        const replace = textLayer.hasSelection() ? selectionEdit() : null;
        if (replace) sendRaw(replace);
        term.paste(text);
        textLayer.releaseSelection();
      };
    }
    const pasteInto = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      const text = (event as ClipboardEvent).clipboardData?.getData("text/plain");
      if (activeRef.current && text) pasteText(text);
    };
    if (textLayer) {
      host.classList.add("terminal-host--touch");
      if (textarea) textarea.tabIndex = -1;
      // Capture phase, so xterm's own paste listener on the textarea does not
      // also send the text.
      host.addEventListener("paste", pasteInto, true);
    }

    const onBeforeInput = (event: InputEvent) => {
      event.preventDefault();
      if (!activeRef.current) return;
      const type = event.inputType;
      const isInsert = type === "insertText" || type === "insertReplacementText";
      const isEnter = type === "insertParagraph" || type === "insertLineBreak";
      const selection = document.getSelection();
      if (selection && !selection.isCollapsed) {
        // A selection inside the command input is deleted first. Elsewhere a
        // delete sends nothing, while typing and Enter drop the selection and
        // go to the cursor as usual.
        const bytes = type.startsWith("delete") || isInsert ? selectionEdit() : null;
        if (type.startsWith("delete") && !bytes) return;
        if (!type.startsWith("delete") && !isInsert && !isEnter) return;
        if (bytes) sendRaw(bytes);
        textLayer?.releaseSelection();
        if (isInsert && event.data) term.input(event.data);
        else if (isEnter) term.input("\r");
        return;
      }
      if (type === "insertReplacementText") {
        // A predictive or spelling replacement names the text it replaces. Send
        // it only when that text can be deleted first; with no target, or one
        // outside the typed command, send nothing so no word is doubled.
        const target = event.getTargetRanges()[0];
        const bytes = target && !target.collapsed ? editFor(target) : null;
        if (!bytes) return;
        sendRaw(bytes);
        if (event.data) term.input(event.data);
      } else if (type === "insertText") {
        if (event.data) term.input(event.data);
      } else if (isEnter) {
        term.input("\r");
      } else if (type === "deleteContentBackward") {
        term.input("\x7f");
      } else if (type === "deleteWordBackward") {
        // Option+Backspace, and iOS's held Backspace once it deletes by word:
        // ESC DEL is what xterm sends for Alt+Backspace.
        term.input("\x1b\x7f");
      } else if (type === "deleteSoftLineBackward" || type === "deleteHardLineBackward") {
        // Command+Backspace: readline's unix-line-discard.
        term.input("\x15");
      }
    };
    // The browser edited the copy anyway (an uncancellable input); put the
    // terminal's rows back, except while an IME is still composing in them.
    const restoreMirror = (event?: Event) => {
      if (event instanceof InputEvent && event.isComposing) return;
      const rows = host.querySelector(".xterm-rows");
      if (rows && textLayer) syncVisibleRows(rows, textLayer.rows);
    };
    const onCompositionEnd = (event: CompositionEvent) => {
      if (activeRef.current && event.data) term.input(event.data);
      restoreMirror();
    };
    const stopXtermMouseFocus = (event: MouseEvent) => event.stopPropagation();
    // Keys that only the browser's text input can turn into characters stay with
    // it: IME and soft-keyboard keys (229, Unidentified, Process), dead keys, and
    // Option characters where xterm reads the platform as a Mac (iPadOS reports
    // MacIntel). There xterm treats Option as a third-level shift and waits for
    // the text the cancelled event would have produced, so forwarding sends nothing.
    const onHardwareKey = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        event.keyCode === 229 ||
        ["Dead", "Unidentified", "Process"].includes(event.key) ||
        (event.metaKey && (event.key.toLowerCase() === "c" || event.key.toLowerCase() === "v")) ||
        (event.key.length === 1 &&
          !event.ctrlKey &&
          !event.metaKey &&
          (!event.altKey || MAC_PLATFORM)) ||
        event.key === "Enter" ||
        event.key === "Backspace" ||
        ["Shift", "Control", "Alt", "Meta"].includes(event.key)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      const forwarded = new KeyboardEvent("keydown", {
        key: event.key,
        code: event.code,
        location: event.location,
        repeat: event.repeat,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        cancelable: true,
      });
      Object.defineProperty(forwarded, "keyCode", { value: event.keyCode });
      textarea?.dispatchEvent(forwarded);
    };
    // Native focus changes (a tap on another control, iOS's hide-keyboard key)
    // reach the key bar's keyboard toggle. A focused host with inputmode "none"
    // has no keyboard up, so it reports as unfocused.
    const onMirrorFocus = () =>
      onFocusChangeRef.current?.(mirror?.getAttribute("inputmode") === "text");
    const onMirrorBlur = () => {
      mirror?.setAttribute("inputmode", "none");
      onFocusChangeRef.current?.(false);
    };
    mirror?.addEventListener("focus", onMirrorFocus);
    mirror?.addEventListener("blur", onMirrorBlur);
    mirror?.addEventListener("beforeinput", onBeforeInput);
    mirror?.addEventListener("input", restoreMirror);
    mirror?.addEventListener("compositionend", onCompositionEnd);
    mirror?.addEventListener("mousedown", stopXtermMouseFocus);
    mirror?.addEventListener("keydown", onHardwareKey);

    const detachGestures = attachGestures(host, {
      term,
      onInput,
      isPhoneScreen: () => phoneScreenRef.current,
      smallScreenIOS: isSmallScreenIOS(currentIOSDevice()),
      textLayer,
    });
    onReady(readyControls);

    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      window.visualViewport?.removeEventListener("resize", fitTerminal);
      textarea?.removeEventListener("focus", reportFocus);
      textarea?.removeEventListener("blur", reportBlur);
      detachGestures();
      mirror?.removeEventListener("focus", onMirrorFocus);
      mirror?.removeEventListener("blur", onMirrorBlur);
      mirror?.removeEventListener("beforeinput", onBeforeInput);
      mirror?.removeEventListener("input", restoreMirror);
      mirror?.removeEventListener("compositionend", onCompositionEnd);
      mirror?.removeEventListener("mousedown", stopXtermMouseFocus);
      mirror?.removeEventListener("keydown", onHardwareKey);
      if (textLayer) {
        host.removeEventListener("paste", pasteInto, true);
        host.classList.remove("terminal-host--touch");
        textLayer.dispose();
      }
      dataSubscription.dispose();
      resizeSubscription.dispose();
      selectionSubscription.dispose();
      writeSubscription.dispose();
      bufferSubscription.dispose();
      clearInputStart();
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
    if (termRef.current.textarea) {
      termRef.current.textarea.tabIndex =
        active && !containerRef.current?.classList.contains("terminal-host--touch") ? 0 : -1;
    }
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
  /** Present on touch devices: the editable copy of the visible rows. */
  textLayer: TouchTextLayer | null;
}

/**
 * Recognises tablet touch gestures for shell keys (swipes, history flicks) and
 * drags for scrollback; phone one-finger drags only scroll. Pointer events cover
 * touch and pen without claiming the mouse.
 *
 * Touches on the editable host are only watched: no preventDefault and no
 * pointer capture, so the browser's taps, caret, long press, and selection
 * handles work as usual. A native selection or a pointercancel (the browser
 * taking the touch over) ends the gesture before it sends or scrolls anything,
 * and a tap there is left to the browser to focus the host.
 *
 * A tap outside the host focuses the terminal from inside the pointerup
 * handler. Safari opens the on-screen keyboard only for a focus() made during a
 * user gesture, and xterm's own focus happens in a synthesised mousedown, which
 * is a weaker claim to that gesture.
 */
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
  // The gesture began on the editable host, whose defaults stay with the browser.
  let nativeTouch = false;

  const cancelGesture = () => {
    active.clear();
    start = null;
    multiTouch = false;
    handled = false;
    twoFingerY = null;
    twoFingerRemainder = 0;
    oneFingerY = null;
    oneFingerRemainder = 0;
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
    if (targets.textLayer?.hasSelection()) {
      cancelGesture();
      return;
    }
    const onHost =
      !!targets.textLayer &&
      event.target instanceof Node &&
      targets.textLayer.mirror.contains(event.target);
    if (active.size === 0) nativeTouch = onHost;
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
    if (targets.textLayer?.hasSelection()) {
      cancelGesture();
      return;
    }
    active.set(event.pointerId, { x: event.clientX, y: event.clientY });

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
      if (!nativeTouch) event.preventDefault();
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
    if (!nativeTouch) event.preventDefault();
  };

  const onPointerEnd = (event: PointerEvent) => {
    if (!active.has(event.pointerId)) return;
    active.delete(event.pointerId);
    if (element.hasPointerCapture?.(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }

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
    if (isTap(sample) && !nativeTouch) {
      // On touch this keeps the current keyboard intent (inputmode); the host's
      // focus listener reports the change.
      if (targets.textLayer) targets.textLayer.mirror.focus();
      else targets.term.focus();
    }
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

/** Matches xterm's own Mac detection (`src/common/Platform.ts`), which iPadOS meets. */
const MAC_PLATFORM = ["Macintosh", "MacIntel", "MacPPC", "Mac68K"].includes(navigator.platform);

/** Output this long after the last sent byte is not an echo of it. */
const UNPROMPTED_OUTPUT_MS = 1_000;

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
