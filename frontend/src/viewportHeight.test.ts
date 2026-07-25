import { describe, expect, it } from "vitest";
import { trackViewportHeight, VIEWPORT_HEIGHT_PROPERTY, type ViewportLike } from "./viewportHeight.js";

function fakeViewport(height: number) {
  const listeners = new Map<string, Set<() => void>>();
  const viewport: ViewportLike = {
    height,
    addEventListener: (type, listener) => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type, listener) => listeners.get(type)?.delete(listener),
  };

  return {
    viewport,
    resizeTo: (next: number) => {
      viewport.height = next;
      for (const listener of listeners.get("resize") ?? []) listener();
    },
    listenerCount: () =>
      [...listeners.values()].reduce((total, set) => total + set.size, 0),
  };
}

describe("trackViewportHeight", () => {
  it("publishes the current height immediately", () => {
    const root = document.createElement("div");
    const { viewport } = fakeViewport(812.4);

    trackViewportHeight(viewport, root);

    expect(root.style.getPropertyValue(VIEWPORT_HEIGHT_PROPERTY)).toBe("812px");
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

  it("stops tracking and drops the property on cleanup", () => {
    const root = document.createElement("div");
    const { viewport, resizeTo, listenerCount } = fakeViewport(812);

    const stop = trackViewportHeight(viewport, root);
    stop();

    expect(listenerCount()).toBe(0);
    expect(root.style.getPropertyValue(VIEWPORT_HEIGHT_PROPERTY)).toBe("");

    resizeTo(476);
    expect(root.style.getPropertyValue(VIEWPORT_HEIGHT_PROPERTY)).toBe("");
  });
});
