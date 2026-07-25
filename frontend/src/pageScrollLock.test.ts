import { describe, expect, it } from "vitest";
import { lockPageScroll, scrollableAncestor } from "./pageScrollLock.js";

/** jsdom lays nothing out, so the scroll geometry is supplied here. */
function sized(element: Element, { client, scroll }: { client: number; scroll: number }) {
  Object.defineProperty(element, "clientHeight", { value: client, configurable: true });
  Object.defineProperty(element, "scrollHeight", { value: scroll, configurable: true });
  Object.defineProperty(element, "clientWidth", { value: client, configurable: true });
  Object.defineProperty(element, "scrollWidth", { value: client, configurable: true });
}

function build(overflowY: string, geometry: { client: number; scroll: number }) {
  document.body.innerHTML = `<div class="outer"><div class="inner"></div></div>`;
  const outer = document.querySelector(".outer") as HTMLElement;
  const inner = document.querySelector(".inner") as HTMLElement;
  outer.style.overflowY = overflowY;
  sized(outer, geometry);
  return { outer, inner };
}

describe("scrollableAncestor", () => {
  it("finds a scroller the drag can still move", () => {
    const { outer, inner } = build("auto", { client: 100, scroll: 400 });
    expect(scrollableAncestor(inner, document.body)).toBe(outer);
  });

  it("ignores a scroller whose content already fits", () => {
    const { inner } = build("auto", { client: 100, scroll: 100 });
    expect(scrollableAncestor(inner, document.body)).toBeNull();
  });

  it("ignores an ancestor that does not scroll at all", () => {
    const { inner } = build("hidden", { client: 100, scroll: 400 });
    expect(scrollableAncestor(inner, document.body)).toBeNull();
  });

  it("stops at the root rather than reporting the page itself", () => {
    document.body.innerHTML = `<div class="inner"></div>`;
    sized(document.body, { client: 100, scroll: 400 });
    document.body.style.overflowY = "auto";

    expect(scrollableAncestor(document.querySelector(".inner"), document.body)).toBeNull();
  });
});

describe("lockPageScroll", () => {
  const touchMove = (target: Element, touches: number) => {
    const event = new Event("touchmove", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "touches", { value: { length: touches } });
    target.dispatchEvent(event);
    return event;
  };

  it("refuses a drag that would only pan the page", () => {
    const { inner } = build("hidden", { client: 100, scroll: 400 });
    const stop = lockPageScroll(document);

    expect(touchMove(inner, 1).defaultPrevented).toBe(true);
    stop();
  });

  it("leaves a drag over a scroller alone", () => {
    const { inner } = build("auto", { client: 100, scroll: 400 });
    const stop = lockPageScroll(document);

    expect(touchMove(inner, 1).defaultPrevented).toBe(false);
    stop();
  });

  // Cancelling one finger of a pinch leaves the page stuck at that scale.
  it("leaves a multi-touch gesture to the browser", () => {
    const { inner } = build("hidden", { client: 100, scroll: 400 });
    const stop = lockPageScroll(document);

    expect(touchMove(inner, 2).defaultPrevented).toBe(false);
    stop();
  });

  it("stops refusing drags once released", () => {
    const { inner } = build("hidden", { client: 100, scroll: 400 });
    lockPageScroll(document)();

    expect(touchMove(inner, 1).defaultPrevented).toBe(false);
  });
});
