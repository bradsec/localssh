// The on-screen keyboard of a phone does not shrink the layout viewport: dvh
// keeps the value it had before the keyboard appeared, so a full-height shell
// keeps its size and the keyboard covers the bottom of it, which on this page is
// the live prompt. visualViewport is the only measurement that accounts for the
// keyboard, so the shell takes its height from there instead.
//
// Height alone is not enough. Safari also pans the visual viewport within the
// layout viewport to lift the focused field clear of the keyboard, and a shell
// laid out from the top of the layout viewport then sits partly above the screen
// with the canvas showing through underneath it, between the shell and the
// keyboard. offsetTop is that pan, so a shell pinned to the visual viewport
// tracks both values.
//
// The events cannot be trusted to deliver the last word either. Safari collapses
// its bottom toolbar once the keyboard has finished animating in, which gives
// the page back around 90px, and it does that without another resize or scroll
// event. A shell sized from the last event is then short by the height of the
// toolbar that is no longer there, showing as a band of canvas above the
// keyboard. Sampling on a timer as well as on the events is what closes it.

/** The part of `window.visualViewport` this needs, so a test can supply one. */
export interface ViewportLike {
  height: number;
  /** How far the visual viewport has been panned down the layout viewport. */
  offsetTop: number;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

/** Custom property the stylesheet reads for the shell height. */
export const VIEWPORT_HEIGHT_PROPERTY = "--app-height";
/** Custom property the stylesheet reads for the shell's offset down the screen. */
export const VIEWPORT_OFFSET_PROPERTY = "--app-viewport-offset";

/**
 * How often the viewport is measured on top of its own events. Short enough
 * that the toolbar collapse is picked up before it can be seen, and cheap
 * because a sample that matches the published value writes nothing.
 */
export const VIEWPORT_SAMPLE_INTERVAL_MS = 100;

/**
 * Publishes the visual viewport height and offset as custom properties on
 * `root`, keeping them current as the keyboard opens and closes, and returns a
 * function that stops tracking and removes the properties.
 */
export function trackViewportHeight(viewport: ViewportLike, root: HTMLElement): () => void {
  let publishedHeight = "";
  let publishedOffset = "";

  // Floor rather than round: a height rounded up past the real viewport gives
  // the page a sliver to scroll, and iOS then drifts the whole layout upward.
  const apply = () => {
    const height = `${Math.floor(viewport.height)}px`;
    const offset = `${Math.round(viewport.offsetTop)}px`;
    // Writing only on a change keeps the timer below off the style path, and
    // with it out of the way of the terminal refitting to a new size.
    if (height !== publishedHeight) {
      publishedHeight = height;
      root.style.setProperty(VIEWPORT_HEIGHT_PROPERTY, height);
    }
    if (offset !== publishedOffset) {
      publishedOffset = offset;
      root.style.setProperty(VIEWPORT_OFFSET_PROPERTY, offset);
    }
  };

  apply();
  // Safari resizes the visual viewport for the keyboard and reports the browser
  // chrome collapsing as a scroll of it, and both change the usable height.
  viewport.addEventListener("resize", apply);
  viewport.addEventListener("scroll", apply);
  // And the last of those changes arrives with no event at all: see the note at
  // the top of this file.
  const sampler = setInterval(apply, VIEWPORT_SAMPLE_INTERVAL_MS);

  return () => {
    clearInterval(sampler);
    viewport.removeEventListener("resize", apply);
    viewport.removeEventListener("scroll", apply);
    root.style.removeProperty(VIEWPORT_HEIGHT_PROPERTY);
    root.style.removeProperty(VIEWPORT_OFFSET_PROPERTY);
  };
}
