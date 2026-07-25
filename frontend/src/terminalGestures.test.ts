import { describe, expect, it } from "vitest";
import { classifyGesture, gestureToInput, isTap } from "./terminalGestures.js";

const flick = { dt: 120, atBottom: true };

describe("classifyGesture", () => {
  it("reads a swipe right as tab", () => {
    expect(classifyGesture({ dx: 90, dy: 4, ...flick })).toBe("tab");
  });

  it("reads a swipe left as escape", () => {
    expect(classifyGesture({ dx: -90, dy: 4, ...flick })).toBe("escape");
  });

  it("reads an upward flick as up and a downward flick as down", () => {
    expect(classifyGesture({ dx: 3, dy: -70, ...flick })).toBe("up");
    expect(classifyGesture({ dx: 3, dy: 70, ...flick })).toBe("down");
  });

  it("ignores movement too small to be a swipe", () => {
    expect(classifyGesture({ dx: 12, dy: 6, ...flick })).toBeNull();
    expect(classifyGesture({ dx: 0, dy: 0, ...flick })).toBeNull();
  });

  it("ignores diagonal movement that commits to no axis", () => {
    expect(classifyGesture({ dx: 80, dy: 75, ...flick })).toBeNull();
  });

  // The cases below are what keep scrollback usable on a touch screen.
  it("leaves vertical drags alone while the user is reading scrollback", () => {
    expect(classifyGesture({ dx: 3, dy: -70, dt: 120, atBottom: false })).toBeNull();
    expect(classifyGesture({ dx: 3, dy: 70, dt: 120, atBottom: false })).toBeNull();
  });

  it("leaves a slow vertical drag alone even at the bottom", () => {
    expect(classifyGesture({ dx: 3, dy: -70, dt: 900, atBottom: true })).toBeNull();
  });

  it("leaves a long vertical drag alone even when it is fast", () => {
    expect(classifyGesture({ dx: 3, dy: -400, dt: 120, atBottom: true })).toBeNull();
  });

  it("still recognises horizontal swipes while reading scrollback", () => {
    expect(classifyGesture({ dx: 90, dy: 4, dt: 900, atBottom: false })).toBe("tab");
  });
});

describe("gestureToInput", () => {
  it("sends tab and escape regardless of cursor mode", () => {
    expect(gestureToInput("tab", false)).toBe("\t");
    expect(gestureToInput("tab", true)).toBe("\t");
    expect(gestureToInput("escape", false)).toBe("\x1b");
  });

  it("encodes cursor keys for normal mode", () => {
    expect(gestureToInput("up", false)).toBe("\x1b[A");
    expect(gestureToInput("down", false)).toBe("\x1b[B");
  });

  // vim and less switch this on; sending CSI there moves the cursor wrongly.
  it("encodes cursor keys for application cursor mode", () => {
    expect(gestureToInput("up", true)).toBe("\x1bOA");
    expect(gestureToInput("down", true)).toBe("\x1bOB");
  });
});

describe("isTap", () => {
  it("accepts a still touch and the drift of a real thumb", () => {
    expect(isTap({ dx: 0, dy: 0 })).toBe(true);
    expect(isTap({ dx: 4, dy: -5 })).toBe(true);
  });

  it("rejects travel that belongs to a swipe or a scroll drag", () => {
    expect(isTap({ dx: 0, dy: 40 })).toBe(false);
    expect(isTap({ dx: 60, dy: 0 })).toBe(false);
  });
});
