// Touch gestures for the terminal, for devices with no physical Tab, Esc, or
// arrow keys.
//
// The hard constraint is that xterm's viewport scrolls vertically by touch, so
// vertical gestures cannot simply be claimed. Horizontal movement is free (the
// terminal never scrolls sideways), so the always-available actions live there.
// Vertical gestures fire only for a deliberate flick taken while the viewport
// is already at the bottom of the buffer; a slow drag, or any drag made while
// reading scrollback, is left alone to scroll.

export type TerminalGesture = "tab" | "escape" | "up" | "down";

export interface GestureSample {
  /** Horizontal travel in CSS pixels, positive to the right. */
  dx: number;
  /** Vertical travel in CSS pixels, positive downward. */
  dy: number;
  /** Duration of the gesture in milliseconds. */
  dt: number;
  /** Whether the terminal viewport is scrolled to the live prompt. */
  atBottom: boolean;
}

/** Minimum travel before movement counts as a swipe rather than a tap. */
const MIN_TRAVEL_PX = 44;
/** A swipe must be this much longer on its main axis to count as that axis. */
const AXIS_RATIO = 1.6;
/** Vertical flicks must complete this quickly to outrank scrolling. */
const FLICK_MAX_MS = 300;
/** Beyond this travel a vertical move reads as a scroll drag, not a flick. */
const FLICK_MAX_TRAVEL_PX = 160;
/** Travel a touch may drift and still count as a tap. */
const TAP_MAX_TRAVEL_PX = 10;

export function classifyGesture({ dx, dy, dt, atBottom }: GestureSample): TerminalGesture | null {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  if (absX >= MIN_TRAVEL_PX && absX >= absY * AXIS_RATIO) {
    return dx > 0 ? "tab" : "escape";
  }

  if (absY >= MIN_TRAVEL_PX && absY >= absX * AXIS_RATIO) {
    // Reading scrollback: leave every vertical drag to the viewport.
    if (!atBottom) return null;
    if (dt > FLICK_MAX_MS || absY > FLICK_MAX_TRAVEL_PX) return null;
    return dy < 0 ? "up" : "down";
  }

  return null;
}

/**
 * Bytes for a gesture. Cursor keys change encoding with the terminal's
 * application cursor mode, which is what full-screen programs like vim and
 * less switch on, so the caller passes the current mode.
 */
export function gestureToInput(
  gesture: TerminalGesture,
  applicationCursorKeys: boolean,
): string {
  switch (gesture) {
    case "tab":
      return "\t";
    case "escape":
      return "\x1b";
    case "up":
      return applicationCursorKeys ? "\x1bOA" : "\x1b[A";
    case "down":
      return applicationCursorKeys ? "\x1bOB" : "\x1b[B";
  }
}

/**
 * Whether a touch stayed still enough to be a tap rather than a swipe or a
 * scroll drag. A tap is what focuses the terminal, so the threshold is small:
 * moving the page and gaining focus at the same time is surprising.
 */
export function isTap({ dx, dy }: Pick<GestureSample, "dx" | "dy">): boolean {
  return Math.hypot(dx, dy) <= TAP_MAX_TRAVEL_PX;
}
