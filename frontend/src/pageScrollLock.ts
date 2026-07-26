// Stopping the page from moving under a running session.
//
// While the on-screen keyboard is up, iOS keeps the layout viewport at its full
// height and shows only the part of it the keyboard leaves. A drag anywhere the
// page does not consume then pans that smaller window over the taller layout
// viewport, which slides the session up the screen and leaves the canvas showing
// where the terminal used to be. There is nothing below the terminal to reach,
// so the pan has nothing to offer and is worth refusing outright.
//
// A drag that some element can actually use is left alone: the terminal's own
// scrollback and the key bar sliding sideways both arrive as touch moves here.

/**
 * The nearest ancestor of `node`, itself included, that can still scroll in some
 * direction, or null when the drag would only move the page.
 */
export function scrollableAncestor(node: Element | null, root: Element): Element | null {
  for (let element = node; element; element = element.parentElement) {
    if (element === root) return null;

    const style = getComputedStyle(element);
    const scrollsY =
      /auto|scroll/.test(style.overflowY) && element.scrollHeight > element.clientHeight;
    const scrollsX =
      /auto|scroll/.test(style.overflowX) && element.scrollWidth > element.clientWidth;
    if (scrollsY || scrollsX) return element;
  }

  return null;
}

/**
 * Refuses touch drags that would only pan the page, and returns a function that
 * stops doing so. Drags over anything with scrolling of its own are untouched.
 */
export function lockPageScroll(target: Document): () => void {
  const root = target.body;

  const onTouchMove = (event: TouchEvent) => {
    // A pinch is the browser's to handle, and cancelling one mid-gesture leaves
    // the page at whatever scale it had reached.
    if (event.touches.length > 1) return;
    if (!event.cancelable) return;
    if (scrollableAncestor(event.target as Element | null, root)) return;
    event.preventDefault();
  };

  // Passive listeners cannot cancel the scroll they are reporting.
  target.addEventListener("touchmove", onTouchMove, { passive: false });
  return () => target.removeEventListener("touchmove", onTouchMove);
}
