import { afterEach, describe, expect, it, vi } from "vitest";
import {
  trackViewportHeight,
  VIEWPORT_HEIGHT_PROPERTY,
  VIEWPORT_OFFSET_PROPERTY,
  VIEWPORT_SAMPLE_INTERVAL_MS,
  type ViewportLike,
} from "./viewportHeight.js";

function fakeViewport(height: number) {
  const listeners = new Map<string, Set<() => void>>();
  const viewport: ViewportLike = {
    height,
    offsetTop: 0,
    addEventListener: (type, listener) => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type, listener) => listeners.get(type)?.delete(listener),
  };

  const emit = (type: string) => {
    for (const listener of listeners.get(type) ?? []) listener();
  };

  return {
    viewport,
    resizeTo: (next: number) => {
      viewport.height = next;
      emit("resize");
    },
    panTo: (next: number) => {
      viewport.offsetTop = next;
      emit("scroll");
    },
    listenerCount: () => [...listeners.values()].reduce((total, set) => total + set.size, 0),
  };
}

describe("trackViewportHeight", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("publishes the current height immediately", () => {
    const root = document.createElement("div");
    const { viewport } = fakeViewport(812.4);

    trackViewportHeight(viewport, root);

    expect(root.style.getPropertyValue(VIEWPORT_HEIGHT_PROPERTY)).toBe("812px");
    expect(root.style.getPropertyValue(VIEWPORT_OFFSET_PROPERTY)).toBe("0px");
  });

  // The keyboard opening is reported as a shrunken visual viewport, and this is
  // what keeps the prompt above it.
  it("follows the viewport as the keyboard opens and closes", () => {
    const root = document.createElement("div");
    const { viewport, resizeTo } = fakeViewport(812);
    trackViewportHeight(viewport, root);

    resizeTo(476);
    expect(root.style.getPropertyValue(VIEWPORT_HEIGHT_PROPERTY)).toBe("476px");

    resizeTo(812);
    expect(root.style.getPropertyValue(VIEWPORT_HEIGHT_PROPERTY)).toBe("812px");
  });

  // Safari pans the visual viewport down the layout viewport for the keyboard.
  // Without the offset the shell is laid out that far above the screen and the
  // canvas shows through below it.
  it("follows the viewport as it is panned", () => {
    const root = document.createElement("div");
    const { viewport, panTo } = fakeViewport(812);
    trackViewportHeight(viewport, root);

    panTo(94.6);
    expect(root.style.getPropertyValue(VIEWPORT_OFFSET_PROPERTY)).toBe("95px");

    panTo(0);
    expect(root.style.getPropertyValue(VIEWPORT_OFFSET_PROPERTY)).toBe("0px");
  });

  // Safari gives the page back the space of its bottom toolbar once the
  // keyboard has settled, and announces that with no event at all. Measured on
  // an iPhone: the shell was left 96px short of the keyboard until this.
  it("picks up a change that arrived without an event", () => {
    vi.useFakeTimers();
    const root = document.createElement("div");
    const { viewport } = fakeViewport(645);
    trackViewportHeight(viewport, root);

    viewport.height = 361;
    expect(root.style.getPropertyValue(VIEWPORT_HEIGHT_PROPERTY)).toBe("645px");

    vi.advanceTimersByTime(VIEWPORT_SAMPLE_INTERVAL_MS);
    expect(root.style.getPropertyValue(VIEWPORT_HEIGHT_PROPERTY)).toBe("361px");
  });

  it("stops sampling once tracking has stopped", () => {
    vi.useFakeTimers();
    const root = document.createElement("div");
    const { viewport } = fakeViewport(645);

    const stop = trackViewportHeight(viewport, root);
    stop();
    viewport.height = 361;
    vi.advanceTimersByTime(VIEWPORT_SAMPLE_INTERVAL_MS * 4);

    expect(root.style.getPropertyValue(VIEWPORT_HEIGHT_PROPERTY)).toBe("");
  });

  it("stops tracking and drops the properties on cleanup", () => {
    const root = document.createElement("div");
    const { viewport, resizeTo, listenerCount } = fakeViewport(812);

    const stop = trackViewportHeight(viewport, root);
    stop();

    expect(listenerCount()).toBe(0);
    expect(root.style.getPropertyValue(VIEWPORT_HEIGHT_PROPERTY)).toBe("");
    expect(root.style.getPropertyValue(VIEWPORT_OFFSET_PROPERTY)).toBe("");

    resizeTo(476);
    expect(root.style.getPropertyValue(VIEWPORT_HEIGHT_PROPERTY)).toBe("");
  });
});
