import { describe, expect, it } from "vitest";
import {
  applyFontOptions,
  applyFontOptionsAcrossFrames,
  isSmallScreenIOS,
  remeasureFamilyFor,
} from "./terminalFont.js";

/** Records every family written, which is what forces a re-measure. */
function fakeTerminal(fontSize: number, fontFamily: string) {
  const familyWrites: string[] = [];
  const state = { fontSize, fontFamily };
  const terminal = {
    options: {
      get fontSize() {
        return state.fontSize;
      },
      set fontSize(next: number) {
        state.fontSize = next;
      },
      get fontFamily() {
        return state.fontFamily;
      },
      set fontFamily(next: string) {
        state.fontFamily = next;
        familyWrites.push(next);
      },
    },
  };

  return { terminal, familyWrites, state };
}

describe("applyFontOptions", () => {
  it("sets the size and leaves the wanted family in place", () => {
    const { terminal, state } = fakeTerminal(14, '"Fira Code", monospace');

    applyFontOptions(terminal, 22, '"Fira Code", monospace');

    expect(state.fontSize).toBe(22);
    expect(state.fontFamily).toBe('"Fira Code", monospace');
  });

  // The re-measure only happens on a family that differs from the current one,
  // so the family has to be written away and back, not just written again.
  it("bounces the family off another one so the terminal measures again", () => {
    const { terminal, familyWrites } = fakeTerminal(14, '"Fira Code", monospace');

    applyFontOptions(terminal, 22, '"Fira Code", monospace');

    expect(familyWrites).toEqual(["monospace", '"Fira Code", monospace']);
  });

  // "System Monospace" is the literal string "monospace", and bouncing it off
  // itself would change nothing and measure nothing.
  it("picks a different intermediate family when the wanted one is monospace", () => {
    const { terminal, familyWrites, state } = fakeTerminal(14, "monospace");

    applyFontOptions(terminal, 22, "monospace");

    expect(familyWrites).toEqual(["sans-serif", "monospace"]);
    expect(state.fontFamily).toBe("monospace");
  });

  it("never offers an intermediate family equal to the wanted one", () => {
    for (const family of [
      "monospace",
      "sans-serif",
      '"Fira Code", monospace',
      '"JetBrains Mono", monospace',
    ]) {
      expect(remeasureFamilyFor(family)).not.toBe(family);
    }
  });
});

describe("applyFontOptionsAcrossFrames", () => {
  it("keeps the other family through one rendered frame", () => {
    const { terminal, familyWrites, state } = fakeTerminal(14, '"Fira Code", monospace');
    const frames: FrameRequestCallback[] = [];
    let restored = false;

    applyFontOptionsAcrossFrames(
      terminal,
      22,
      '"Fira Code", monospace',
      () => {
        restored = true;
      },
      (callback) => {
        frames.push(callback);
        return frames.length;
      },
      () => {},
    );

    expect(state.fontSize).toBe(22);
    expect(state.fontFamily).toBe("monospace");
    expect(familyWrites).toEqual(["monospace"]);

    frames.shift()?.(0);

    expect(state.fontFamily).toBe("monospace");
    expect(restored).toBe(false);

    frames.shift()?.(16);

    expect(state.fontFamily).toBe('"Fira Code", monospace');
    expect(familyWrites).toEqual(["monospace", '"Fira Code", monospace']);
    expect(restored).toBe(true);
  });

  it("cancels a pending restore so it cannot overwrite a newer choice", () => {
    const { terminal, state } = fakeTerminal(14, '"Fira Code", monospace');
    const frames = new Map<number, FrameRequestCallback>();
    let nextHandle = 0;
    const requestFrame = (callback: FrameRequestCallback) => {
      const handle = ++nextHandle;
      frames.set(handle, callback);
      return handle;
    };
    const cancelFrame = (handle: number) => frames.delete(handle);

    const cancel = applyFontOptionsAcrossFrames(
      terminal,
      22,
      '"Fira Code", monospace',
      () => {},
      requestFrame,
      cancelFrame,
    );
    frames.get(1)?.(0);
    cancel();
    state.fontFamily = '"JetBrains Mono", monospace';
    frames.get(2)?.(16);

    expect(state.fontFamily).toBe('"JetBrains Mono", monospace');
  });
});

describe("isSmallScreenIOS", () => {
  it("detects an iPhone-sized iOS device", () => {
    expect(
      isSmallScreenIOS({
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
        platform: "iPhone",
        maxTouchPoints: 5,
        screenWidth: 393,
        screenHeight: 852,
      }),
    ).toBe(true);
  });

  it("does not apply the workaround to desktop Safari", () => {
    expect(
      isSmallScreenIOS({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15",
        platform: "MacIntel",
        maxTouchPoints: 0,
        screenWidth: 1512,
        screenHeight: 982,
      }),
    ).toBe(false);
  });

  it("does not apply the workaround to an iPad-sized device", () => {
    expect(
      isSmallScreenIOS({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15",
        platform: "MacIntel",
        maxTouchPoints: 5,
        screenWidth: 820,
        screenHeight: 1180,
      }),
    ).toBe(false);
  });
});
