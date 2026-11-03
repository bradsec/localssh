import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function connect(page: Page, touch = true) {
  const address = process.env.E2E_SSHD_ADDR!;
  const split = address.lastIndexOf(":");
  await page.goto("/");
  await page.getByLabel(/^Host$/i).fill(address.slice(0, split));
  await page.getByLabel(/^Port$/i).fill(address.slice(split + 1));
  await page.getByLabel(/^Username$/i).fill("tester");
  await page.getByLabel(/^Password$/i).fill("s3cret");
  const press = (name: RegExp) => {
    const button = page.getByRole("button", { name });
    return touch ? button.tap() : button.click();
  };
  await press(/^Connect to server$/i);
  await press(/trust and connect/i);
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
}

async function typeInShell(page: Page, text: string) {
  await page.locator(".terminal-touch-text").focus();
  await page.keyboard.type(text);
}

test("terminal input has no visible focus decoration while buttons keep theirs", async ({
  page,
}) => {
  await connect(page);
  const input = page.locator(".terminal-touch-text");
  await expect(input).toBeFocused();
  await expect(input).toHaveCSS("outline-style", "none");
  await expect(input).toHaveCSS("box-shadow", "none");
  await expect(input).toHaveCSS("opacity", "1");

  const actions = page.getByRole("button", { name: "Actions" });
  await actions.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(actions).toBeFocused();
  await expect(actions).toHaveCSS("outline-style", "solid");
  await expect(actions).toHaveCSS("outline-width", "3px");
});

test("the editable layer mirrors live rows and keeps xterm accessibility output", async ({
  page,
}) => {
  await connect(page);
  await typeInShell(page, "mirrored");
  const mirror = page.locator(".terminal-touch-text");
  await expect(mirror).toContainText("mirrored");
  await expect(mirror).toHaveAttribute("contenteditable", "plaintext-only");
  await expect(mirror).not.toHaveAttribute("aria-hidden", "true");
  await expect(page.locator(".xterm-accessibility-tree")).toHaveCount(1);

  const layout = await page.evaluate(() => {
    const source = document.querySelector<HTMLElement>(".xterm-rows")!;
    const copy = document.querySelector<HTMLElement>(".terminal-touch-rows")!;
    const style = (element: Element) => {
      const computed = getComputedStyle(element);
      return [computed.fontFamily, computed.fontSize, computed.lineHeight].join("|");
    };
    return {
      rows: [source.children.length, copy.children.length],
      sameFont: style(source) === style(copy),
      tops: Array.from(source.children, (row, i) => [
        Math.round(row.getBoundingClientRect().top),
        Math.round(copy.children[i]!.getBoundingClientRect().top),
      ]),
    };
  });
  expect(layout.rows[1]).toBe(layout.rows[0]);
  expect(layout.sameFont).toBe(true);
  for (const [source, copy] of layout.tops) expect(copy).toBe(source);
});

test("Actions has no Select text entry", async ({ page }) => {
  await connect(page);
  await page.getByRole("button", { name: "Actions" }).tap();
  await expect(page.getByRole("button", { name: "Select text" })).toHaveCount(0);
});

test("a tap on terminal text focuses the editable host", async ({ page }) => {
  await connect(page);
  await typeInShell(page, "tapme");
  const host = page.locator(".terminal-touch-text");
  await expect(host).toContainText("tapme");
  await host.evaluate((element: HTMLElement) => element.blur());
  const point = await host.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  });
  await page.touchscreen.tap(point.x, point.y);
  await expect(host).toBeFocused();
  await expect(page.locator(".xterm-helper-textarea")).not.toBeFocused();
});

test("a touch outside the mirror does not focus xterm's textarea", async ({ page }) => {
  await connect(page);
  const focused = await page.locator(".terminal-host").evaluate((host) => {
    const mirror = host.querySelector<HTMLElement>(".terminal-touch-text")!;
    mirror.blur();
    host.setPointerCapture = () => {};
    host.hasPointerCapture = () => false;
    for (const type of ["pointerdown", "pointerup"]) {
      host.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerType: "touch",
          pointerId: 9,
          clientX: 10,
          clientY: 10,
        }),
      );
    }
    return {
      mirror: document.activeElement === mirror,
      textarea: document.activeElement === host.querySelector(".xterm-helper-textarea"),
    };
  });
  expect(focused).toEqual({ mirror: true, textarea: false });
});

test("a paste event sends text to the session once", async ({ page }) => {
  await connect(page);
  await page.locator(".terminal-touch-text").evaluate((element) => {
    const data = new DataTransfer();
    data.setData("text/plain", "plain-paste");
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(page.locator(".xterm-rows")).toContainText("plain-paste");
  await page.waitForTimeout(300);
  expect((await page.locator(".xterm-rows").textContent())?.match(/plain-paste/g)).toHaveLength(1);
});

test("a selection in the mirror keeps the editing host focused", async ({ page }) => {
  await connect(page);
  await typeInShell(page, "keepkeys");
  const host = page.locator(".terminal-touch-text");
  await host.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element.firstElementChild!);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
  });
  await expect(host).toBeFocused();
  expect(await page.evaluate(() => document.getSelection()?.toString().length)).toBeGreaterThan(0);
});

test("touches on the editing host keep browser gesture defaults", async ({ page }) => {
  await connect(page);
  const result = await page.locator(".terminal-touch-text").evaluate((element) => {
    const down = new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerId: 9,
      pointerType: "touch",
    });
    element.dispatchEvent(down);
    element.dispatchEvent(
      new PointerEvent("pointercancel", {
        bubbles: true,
        pointerId: 9,
        pointerType: "touch",
      }),
    );
    return down.defaultPrevented;
  });
  expect(result).toBe(false);
});

/** Centre of the first occurrence of `text` inside the editable copy of the rows. */
function centreOf(page: Page, text: string) {
  return page.locator(".terminal-touch-rows").evaluate((rows, needle) => {
    const walker = document.createTreeWalker(rows, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const index = node.textContent!.indexOf(needle);
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + needle.length);
      const box = range.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }
    throw new Error(`"${needle}" is not in the text layer`);
  }, text);
}

/**
 * Dispatches a touch pointer event at a point and reports whether a listener
 * cancelled it or captured the pointer, which would take the touch from the
 * browser's own selection.
 */
function touchEvent(page: Page, type: string, x: number, y: number, pointerId = 7) {
  return page.evaluate(
    ([eventType, clientX, clientY, id]) => {
      let captured = false;
      const original = Element.prototype.setPointerCapture;
      Element.prototype.setPointerCapture = () => {
        captured = true;
      };
      const target = document.elementFromPoint(clientX as number, clientY as number)!;
      const event = new PointerEvent(eventType as string, {
        bubbles: true,
        cancelable: true,
        pointerId: id as number,
        pointerType: "touch",
        clientX: clientX as number,
        clientY: clientY as number,
      });
      target.dispatchEvent(event);
      Element.prototype.setPointerCapture = original;
      return {
        onHost: !!target.closest(".terminal-touch-text"),
        prevented: event.defaultPrevented,
        captured,
      };
    },
    [type, x, y, pointerId],
  );
}

test.describe("tablet", () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test("swipe keys work over the editing host and stand down for a native selection", async ({
    page,
  }) => {
    await connect(page);
    await typeInShell(page, "ab");
    await expect(page.locator(".terminal-touch-text")).toContainText("ab");
    const point = await centreOf(page, "ab");

    const swipe = async () => {
      const results = [
        await touchEvent(page, "pointerdown", point.x + 100, point.y + 120),
        await touchEvent(page, "pointermove", point.x + 160, point.y + 120),
        await touchEvent(page, "pointermove", point.x + 240, point.y + 120),
        await touchEvent(page, "pointerup", point.x + 240, point.y + 120),
      ];
      // The host keeps the browser's defaults: nothing cancelled or captured.
      for (const result of results) {
        expect(result).toEqual({ onHost: true, prevented: false, captured: false });
      }
    };

    // Control: with no selection a right swipe sends Tab, which the echo shows as a gap.
    await swipe();
    await page.keyboard.type("Y");
    await expect(page.locator(".xterm-rows")).toContainText(/ab\s+Y/);

    // A touch the browser takes over (pointercancel) sends nothing.
    await touchEvent(page, "pointerdown", point.x + 100, point.y + 120);
    await touchEvent(page, "pointercancel", point.x + 100, point.y + 120);
    await touchEvent(page, "pointermove", point.x + 240, point.y + 120);
    await touchEvent(page, "pointerup", point.x + 240, point.y + 120);

    await page.evaluate(() => {
      const rows = document.querySelector(".terminal-touch-rows")!;
      const range = document.createRange();
      range.selectNodeContents(rows.firstElementChild!);
      document.getSelection()!.removeAllRanges();
      document.getSelection()!.addRange(range);
    });
    await swipe();
    // A tap dismisses a native selection to a caret.
    await page.evaluate(() => document.getSelection()!.collapseToEnd());
    await typeInShell(page, "Z");
    await expect(page.locator(".xterm-rows")).toContainText(/ab\s+YZ/);
  });
});

test.describe("desktop", () => {
  test.use({ hasTouch: false, isMobile: false, viewport: { width: 1280, height: 800 } });

  test("keeps xterm's own selection and adds no editable layer", async ({ page }) => {
    await connect(page, false);
    await expect(page.locator(".terminal-touch-text")).toHaveCount(0);
    await expect(page.locator(".terminal-host--touch")).toHaveCount(0);
  });
});
