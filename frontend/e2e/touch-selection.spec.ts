import { expect, test, type Page } from "@playwright/test";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

async function connect(page: Page, touch = true) {
  const sshdAddress = process.env.E2E_SSHD_ADDR;
  expect(sshdAddress, "global setup must provide the SSH server address").toBeTruthy();

  const separator = sshdAddress!.lastIndexOf(":");
  await page.goto("/");
  await page.getByLabel(/^Host$/i).fill(sshdAddress!.slice(0, separator));
  await page.getByLabel(/^Port$/i).fill(sshdAddress!.slice(separator + 1));
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

test("Select text shows frozen DOM output and blocks shell input", async ({ page }) => {
  await connect(page);
  await page
    .locator(".xterm-helper-textarea")
    .evaluate((textarea: HTMLTextAreaElement) => textarea.focus());
  await page.keyboard.type("selectme");
  await expect(page.locator(".xterm-rows")).toContainText("selectme");

  await page.getByRole("button", { name: "Actions" }).tap();
  await page.getByRole("button", { name: "Select text" }).tap();
  const view = page.getByRole("dialog", { name: "Select text" });
  await expect(view.locator("pre")).toContainText("selectme");
  await expect(page.locator(".xterm-helper-textarea")).not.toBeFocused();

  const selected = await view.locator("pre").evaluate((pre) => {
    const range = document.createRange();
    range.selectNodeContents(pre);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  });
  expect(selected).toContain("selectme");

  await page.keyboard.type("must-not-reach-shell");
  await expect(view.locator("pre")).not.toContainText("must-not-reach-shell");
  await page.getByRole("button", { name: "Close text view" }).tap();
  await expect(view).toHaveCount(0);
  await expect(page.locator(".xterm-rows")).not.toContainText("must-not-reach-shell");
});

async function typeInShell(page: Page, text: string) {
  await page
    .locator(".xterm-helper-textarea")
    .evaluate((textarea: HTMLTextAreaElement) => textarea.focus());
  await page.keyboard.type(text);
}

/** Centre of the first occurrence of `text` inside the selectable copy of the rows. */
function centreOf(page: Page, text: string) {
  return page.locator(".terminal-touch-text").evaluate((mirror, needle) => {
    const walker = document.createTreeWalker(mirror, NodeFilter.SHOW_TEXT);
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

function touchEvent(page: Page, type: string, x: number, y: number) {
  return page.evaluate(
    ([eventType, clientX, clientY]) => {
      // A dispatched event has no live pointer to capture; real touches do.
      Element.prototype.setPointerCapture = () => {};
      const target = document.elementFromPoint(clientX as number, clientY as number)!;
      target.dispatchEvent(
        new PointerEvent(eventType as string, {
          bubbles: true,
          cancelable: true,
          pointerId: 7,
          pointerType: "touch",
          clientX: clientX as number,
          clientY: clientY as number,
        }),
      );
    },
    [type, x, y],
  );
}

test("no floating Select text pill covers the terminal", async ({ page }) => {
  await connect(page);
  await expect(page.locator(".terminal-select-button")).toHaveCount(0);
  await expect(page.locator(".terminal-host > .terminal-select-button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Select text" })).toHaveCount(0);
  await page.getByRole("button", { name: "Actions" }).tap();
  await expect(page.getByRole("button", { name: "Select text" })).toBeVisible();
});

test("the selectable text layer mirrors the live rows and hides from screen readers", async ({
  page,
}) => {
  await connect(page);
  await typeInShell(page, "mirrored");
  await expect(page.locator(".terminal-touch-text")).toContainText("mirrored");
  await expect(page.locator(".terminal-touch-text")).toHaveAttribute("aria-hidden", "true");

  const same = await page.evaluate(() => {
    const live = Array.from(document.querySelectorAll(".xterm-rows > div"));
    const copy = Array.from(document.querySelectorAll(".terminal-touch-text > div"));
    const font = (element: Element) => {
      const style = getComputedStyle(element);
      return [style.fontFamily, style.fontSize, style.lineHeight].join("|");
    };
    return {
      rows: [live.length, copy.length],
      sameFont:
        font(document.querySelector(".xterm-rows")!) ===
        font(document.querySelector(".terminal-touch-text")!),
      heights: live.map((row, i) => [
        row.getBoundingClientRect().height,
        copy[i]!.getBoundingClientRect().height,
      ]),
      tops: live.map((row, i) => [
        Math.round(row.getBoundingClientRect().top),
        Math.round(copy[i]!.getBoundingClientRect().top),
      ]),
      textWidth: (() => {
        const rangeOf = (root: Element) => {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const index = node.textContent!.indexOf("mirrored");
            if (index < 0) continue;
            const range = document.createRange();
            range.setStart(node, index);
            range.setEnd(node, index + 8);
            const box = range.getBoundingClientRect();
            return [Math.round(box.left), Math.round(box.width), Math.round(box.top)];
          }
          return null;
        };
        return [
          rangeOf(document.querySelector(".xterm-rows")!),
          rangeOf(document.querySelector(".terminal-touch-text")!),
        ];
      })(),
    };
  });
  expect(same.rows[1]).toBe(same.rows[0]);
  expect(same.sameFont).toBe(true);
  for (const [a, b] of same.heights) expect(b).toBeCloseTo(a!, 1);
  for (const [a, b] of same.tops) expect(b).toBe(a);
  expect(same.textWidth[1]).toEqual(same.textWidth[0]);
});

test("long press on visible text creates a DOM selection in the text layer", async ({ page }) => {
  await connect(page);
  await typeInShell(page, "selectme");
  await expect(page.locator(".terminal-touch-text")).toContainText("selectme");

  const point = await centreOf(page, "selectme");
  await touchEvent(page, "pointerdown", point.x, point.y);
  await expect
    .poll(() => page.evaluate(() => document.getSelection()?.toString()), {
      timeout: 3_000,
    })
    .toContain("selectme");
  const inMirror = await page.evaluate(() =>
    document.querySelector(".terminal-touch-text")!.contains(document.getSelection()!.anchorNode),
  );
  expect(inMirror).toBe(true);
  await touchEvent(page, "pointerup", point.x, point.y);
});

test("long press on empty space selects nothing", async ({ page }) => {
  await connect(page);
  await typeInShell(page, "left");
  await expect(page.locator(".terminal-touch-text")).toContainText("left");
  const box = (await page.locator(".xterm-screen").boundingBox())!;
  const point = await centreOf(page, "left");
  await touchEvent(page, "pointerdown", box.x + box.width - 6, point.y);
  await page.waitForTimeout(900);
  expect(await page.evaluate(() => document.getSelection()?.toString())).toBe("");
  await touchEvent(page, "pointerup", box.x + box.width - 6, point.y);
});

test("a tap on text still focuses the terminal", async ({ page }) => {
  await connect(page);
  await typeInShell(page, "tapme");
  await expect(page.locator(".terminal-touch-text")).toContainText("tapme");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(page.locator(".xterm-helper-textarea")).not.toBeFocused();
  const point = await centreOf(page, "tapme");
  await page.touchscreen.tap(point.x, point.y);
  await expect(page.locator(".xterm-helper-textarea")).toBeFocused();
  expect(await page.evaluate(() => document.getSelection()?.toString())).toBe("");
});

test("a tap on empty space focuses the terminal", async ({ page }) => {
  await connect(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const box = (await page.locator(".xterm-screen").boundingBox())!;
  await page.touchscreen.tap(box.x + box.width - 6, box.y + box.height - 6);
  await expect(page.locator(".xterm-helper-textarea")).toBeFocused();
});

async function pasteInto(page: Page, text: string) {
  await page.locator(".xterm-helper-textarea").evaluate((textarea, value) => {
    (textarea as HTMLTextAreaElement).focus();
    const data = new DataTransfer();
    data.setData("text/plain", value);
    textarea.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, text);
}

test("a paste event sends the text to the session once", async ({ page }) => {
  await connect(page);
  await pasteInto(page, "plain-paste");
  // The test server echoes what it receives, so a double send would show twice.
  await expect(page.locator(".xterm-rows")).toContainText("plain-paste");
  await page.waitForTimeout(300);
  expect(await page.locator(".xterm-rows").textContent()).not.toContain("plain-pasteplain-paste");
});

test.describe("tablet", () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test("swipe keys stand down while a native selection exists", async ({ page }) => {
    await connect(page);
    await typeInShell(page, "ab");
    await expect(page.locator(".terminal-touch-text")).toContainText("ab");
    const point = await centreOf(page, "ab");

    const swipe = async () => {
      await touchEvent(page, "pointerdown", point.x + 100, point.y + 120);
      await touchEvent(page, "pointermove", point.x + 160, point.y + 120);
      await touchEvent(page, "pointermove", point.x + 240, point.y + 120);
      await touchEvent(page, "pointerup", point.x + 240, point.y + 120);
    };

    // Control: with no selection a right swipe sends Tab, which the echo shows as a gap.
    await swipe();
    await page.keyboard.type("Y");
    await expect(page.locator(".xterm-rows")).toContainText(/ab\s+Y/);

    await page.evaluate(() => {
      const mirror = document.querySelector(".terminal-touch-text")!;
      const range = document.createRange();
      range.selectNodeContents(mirror.firstElementChild!);
      document.getSelection()!.removeAllRanges();
      document.getSelection()!.addRange(range);
    });
    await swipe();
    await typeInShell(page, "Z");
    await expect(page.locator(".xterm-rows")).toContainText(/ab\s+YZ/);
  });
});

test.describe("desktop", () => {
  test.use({
    hasTouch: false,
    isMobile: false,
    viewport: { width: 1280, height: 800 },
  });

  test("keeps xterm's own selection and adds no text layer", async ({ page }) => {
    await connect(page, false);
    await expect(page.locator(".terminal-touch-text")).toHaveCount(0);
    await expect(page.locator(".terminal-host--touch")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Select text" })).toHaveCount(0);
  });
});

test("the input field covers only the cursor row, so a focused keyboard leaves other rows selectable", async ({
  page,
}) => {
  await connect(page);
  await typeInShell(page, "rowcheck");
  await page.locator(".xterm-screen").tap();
  await expect(page.locator(".xterm-helper-textarea")).toBeFocused();

  const layout = await page.evaluate(() => {
    const field = document
      .querySelector<HTMLElement>(".xterm-helper-textarea")!
      .getBoundingClientRect();
    const screen = document.querySelector<HTMLElement>(".xterm-screen")!.getBoundingClientRect();
    const row = document.querySelector<HTMLElement>(".xterm-rows > div")!.getBoundingClientRect();
    const hitAbove = document.elementFromPoint(
      screen.left + screen.width / 2,
      field.top - row.height * 1.5,
    );
    return {
      fieldHeight: field.height,
      rowHeight: row.height,
      fieldRight: field.right,
      screenRight: screen.right,
      aboveIsField: !!hitAbove?.closest(".xterm-helper-textarea"),
    };
  });
  expect(layout.fieldHeight).toBeCloseTo(layout.rowHeight, 0);
  expect(Math.abs(layout.fieldRight - layout.screenRight)).toBeLessThanOrEqual(1);
  expect(layout.aboveIsField).toBe(false);
});

test("a selection in the text layer drops the keyboard so iOS can show Copy", async ({ page }) => {
  await connect(page);
  await typeInShell(page, "dropkeys");
  await expect(page.locator(".terminal-touch-text")).toContainText("dropkeys");
  await expect(page.locator(".xterm-helper-textarea")).toBeFocused();

  // A selection made by the browser itself, as Safari's long press does.
  await page.evaluate(() => {
    const text = document.querySelector(".terminal-touch-text > div")!;
    const range = document.createRange();
    range.selectNodeContents(text);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
  });
  await expect(page.locator(".xterm-helper-textarea")).not.toBeFocused();
  expect(await page.evaluate(() => document.getSelection()?.toString().length)).toBeGreaterThan(0);
});
