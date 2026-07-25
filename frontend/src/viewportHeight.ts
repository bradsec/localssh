// The on-screen keyboard of a phone does not shrink the layout viewport: dvh
// keeps the value it had before the keyboard appeared, so a full-height shell
// keeps its size and the keyboard covers the bottom of it, which on this page is
// the live prompt. visualViewport is the only measurement that accounts for the
// keyboard, so the shell takes its height from there instead.

/** The part of `window.visualViewport` this needs, so a test can supply one. */
export interface ViewportLike {
  height: number;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

/** Custom property the stylesheet reads for the shell height. */
export const VIEWPORT_HEIGHT_PROPERTY = "--app-height";

/**
 * Publishes the visual viewport height as a custom property on `root`, keeping it
 * current as the keyboard opens and closes, and returns a function that stops
 * tracking and removes the property.
 */
export function trackViewportHeight(viewport: ViewportLike, root: HTMLElement): () => void {
  // Floor rather than round: a height rounded up past the real viewport gives
  // the page a sliver to scroll, and iOS then drifts the whole layout upward.
  const apply = () => {
    root.style.setProperty(VIEWPORT_HEIGHT_PROPERTY, `${Math.floor(viewport.height)}px`);
  };

  apply();
  // Safari resizes the visual viewport for the keyboard and reports the browser
  // chrome collapsing as a scroll of it, and both change the usable height.
  viewport.addEventListener("resize", apply);
  viewport.addEventListener("scroll", apply);

  return () => {
    viewport.removeEventListener("resize", apply);
    viewport.removeEventListener("scroll", apply);
    root.style.removeProperty(VIEWPORT_HEIGHT_PROPERTY);
  };
}
