import { expect, test } from "@playwright/test";

// A phone, where the terminal keys the bar supplies are the only ones there are.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("short landscape combines target, keys, and Actions", async ({ page }) => {
  const address = process.env.E2E_SSHD_ADDR!;
  const separator = address.lastIndexOf(":");
  await page.setViewportSize({ width: 844, height: 390 });
  await page.addInitScript(() => {
    localStorage.setItem("terminalSettings", JSON.stringify({ keepAlive: "off" }));
    const Original = window.WebSocket;
    const sockets: WebSocket[] = [];
    Object.assign(window, { testSockets: sockets });
    window.WebSocket = class extends Original {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        sockets.push(this);
      }
    };
  });
  await page.goto("/");
  await page.getByLabel(/^Host$/i).fill(address.slice(0, separator));
  await page.getByLabel(/^Port$/i).fill(address.slice(separator + 1));
  await page.getByLabel(/^Username$/i).fill("tester");
  await page.getByLabel(/^Password$/i).fill("s3cret");
  await page.getByRole("button", { name: /^Connect to server$/i }).tap();
  await page.getByRole("button", { name: /trust and connect/i }).tap();

  const target = page.getByRole("button", { name: /Open terminals.*tester@/ });
  const actions = page.getByRole("button", { name: "Actions" });
  const keys = page.getByRole("toolbar", { name: "Terminal keys" });
  await expect(target).toContainText("Connected");
  await expect(target).toHaveAttribute(
    "aria-label",
    `Open terminals, tester@${address}, Connected`,
  );
  const [targetBox, actionsBox, keysBox] = await Promise.all([
    target.boundingBox(),
    actions.boundingBox(),
    keys.boundingBox(),
  ]);
  expect(targetBox && actionsBox && keysBox).toBeTruthy();
  expect(Math.abs(targetBox!.y - keysBox!.y)).toBeLessThanOrEqual(1);
  expect(actionsBox!.y).toBeGreaterThanOrEqual(keysBox!.y);
  expect(actionsBox!.y + actionsBox!.height).toBeLessThanOrEqual(keysBox!.y + keysBox!.height);
  expect(targetBox!.width).toBeLessThanOrEqual(844 * 0.35 + 1);
  await target.tap();
  await expect(page.getByRole("tablist", { name: "Open terminals" })).toBeVisible();
  await target.tap();
  await actions.tap();
  await expect(page.getByRole("group", { name: "Actions" })).toBeVisible();
  await actions.tap();

  await page.evaluate(() =>
    (window as unknown as { testSockets: WebSocket[] }).testSockets.at(-1)?.close(),
  );
  await expect(target).toContainText("Disconnected");
});

test("short landscape names a resuming session", async ({ page, context }) => {
  const address = process.env.E2E_SSHD_ADDR!;
  const separator = address.lastIndexOf(":");
  await page.setViewportSize({ width: 844, height: 390 });
  await page.addInitScript(() => {
    const Original = window.WebSocket;
    const sockets: WebSocket[] = [];
    Object.assign(window, { testSockets: sockets });
    window.WebSocket = class extends Original {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        sockets.push(this);
      }
    };
  });
  await page.goto("/");
  await page.getByLabel(/^Host$/i).fill(address.slice(0, separator));
  await page.getByLabel(/^Port$/i).fill(address.slice(separator + 1));
  await page.getByLabel(/^Username$/i).fill("tester");
  await page.getByLabel(/^Password$/i).fill("s3cret");
  await page.getByRole("button", { name: /^Connect to server$/i }).tap();
  await page.getByRole("button", { name: /trust and connect/i }).tap();
  const target = page.getByRole("button", { name: /Open terminals.*tester@/ });
  await expect(target).toContainText("Connected");
  const resumingLabel = page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const button = document.querySelector<HTMLButtonElement>(".session-identity--switcher")!;
        const observer = new MutationObserver(() => {
          if (!button.textContent?.includes("Resuming")) return;
          observer.disconnect();
          resolve(button.getAttribute("aria-label") ?? "");
        });
        observer.observe(button, { attributes: true, childList: true, subtree: true });
      }),
  );
  await context.setOffline(true);
  await page.evaluate(() =>
    (window as unknown as { testSockets: WebSocket[] }).testSockets.at(-1)?.close(),
  );
  expect(await resumingLabel).toContain("Resuming");
  await context.setOffline(false);
});

test("supplies terminal keys for the whole session, keyboard or not", async ({ page }) => {
  const sshdAddress = process.env.E2E_SSHD_ADDR;
  expect(sshdAddress, "global setup must provide the SSH server address").toBeTruthy();

  const separator = sshdAddress!.lastIndexOf(":");

  // Five keys fit the row at 390px, so these are the ones the test presses.
  await page.addInitScript(() =>
    localStorage.setItem(
      "terminalSettings",
      JSON.stringify({ keyBarKeys: ["tilde", "ctrl", "up", "enter", "esc"] }),
    ),
  );
  await page.goto("/");
  await page.getByLabel(/^Host$/i).fill(sshdAddress!.slice(0, separator));
  await page.getByLabel(/^Port$/i).fill(sshdAddress!.slice(separator + 1));
  await page.getByLabel(/^Username$/i).fill("tester");
  await page.getByLabel(/^Password$/i).fill("s3cret");
  await page.getByRole("button", { name: /^Connect to server$/i }).tap();
  await page.getByRole("button", { name: /trust and connect/i }).tap();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();

  const keyBar = page.getByRole("toolbar", { name: /terminal keys/i });
  const terminalInput = page.locator(".xterm-helper-textarea");

  await expect(keyBar).toBeVisible();

  // The bar has to keep the focus that raised the keyboard, or the keyboard
  // closes under the first key pressed on it.
  await page.getByRole("button", { name: /^tilde$/i }).tap();
  await expect(terminalInput).toBeFocused();
  await expect(page.locator(".xterm-rows")).toContainText("~", { timeout: 5_000 });
  await expect(page.locator(".xterm-rows")).not.toContainText("~~");

  // The keyboard toggle is the terminal's focus under a button, so it is the
  // one key on the bar that does take focus away.
  await page.getByRole("button", { name: /hide keyboard/i }).tap();
  await expect(terminalInput).not.toBeFocused();
  await page.getByRole("button", { name: /show keyboard/i }).tap();
  await expect(terminalInput).toBeFocused();

  // Its keys write to the session directly, so they still reach the host with
  // the terminal blurred, which on a phone is the keyboard put away.
  await terminalInput.blur();
  await page.getByRole("button", { name: /^up arrow$/i }).tap();
  await page.getByRole("button", { name: /^enter$/i }).tap();
  await expect(terminalInput).not.toBeFocused();
  await expect(keyBar).toBeVisible();

  // Ctrl is armed by the bar and spent by the next character typed on the
  // system keyboard, which is where the letters are. The server echoes what it
  // receives, so a letter that arrived as a control code has no glyph to echo.
  const rows = page.locator(".xterm-rows");
  await page.locator(".xterm-screen").tap();
  await expect(terminalInput).toBeFocused();
  await page.keyboard.type("AA");
  await page.getByRole("button", { name: /^ctrl$/i }).tap();
  await page.keyboard.type("q");
  await page.keyboard.type("BB");

  await expect(rows).toContainText("AABB", { timeout: 5_000 });

  // The bar sits below the terminal rather than over it.
  const terminalBox = await page.locator(".terminal-frame").boundingBox();
  const barBox = await keyBar.boundingBox();
  expect(terminalBox && barBox && terminalBox.y + terminalBox.height).toBeLessThanOrEqual(
    barBox!.y + 1,
  );

  // At phone width Disconnect sits behind Actions.
  await page.getByRole("button", { name: "Actions" }).tap();
  await page.getByRole("button", { name: /disconnect/i }).tap();
  await expect(keyBar).toBeHidden();
});

test("sends Shift Tab as ESC [ Z and stops Text larger at 32", async ({ page }) => {
  const address = process.env.E2E_SSHD_ADDR!;
  const separator = address.lastIndexOf(":");
  await page.addInitScript(() =>
    localStorage.setItem(
      "terminalSettings",
      JSON.stringify({ fontSize: 31, keyBarKeys: ["tab", "shift-tab", "text-larger"] }),
    ),
  );
  await page.goto("/");
  await page.getByLabel(/^Host$/i).fill(address.slice(0, separator));
  await page.getByLabel(/^Port$/i).fill(address.slice(separator + 1));
  await page.getByLabel(/^Username$/i).fill("tester");
  await page.getByLabel(/^Password$/i).fill("s3cret");
  await page.getByRole("button", { name: /^Connect to server$/i }).tap();
  await page.getByRole("button", { name: /trust and connect/i }).tap();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();

  // The server echoes input and xterm interprets it, so ESC [ Z (back tab)
  // is seen by its effect: Tab jumps the cursor to column 8, Shift Tab returns
  // it to column 0, and the next letter overwrites the first one typed.
  await page.locator(".xterm-screen").tap();
  await expect(page.locator(".xterm-helper-textarea")).toBeFocused();
  await page.keyboard.type("ab");
  await page.getByRole("button", { name: /^tab$/i }).tap();
  await page.getByRole("button", { name: /^shift tab$/i }).tap();
  await page.keyboard.type("X");
  await expect(page.locator(".xterm-rows")).toContainText("Xb", { timeout: 5_000 });

  const larger = page.getByRole("button", { name: /^text larger$/i });
  await larger.tap();
  await expect(larger).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText("Text size 32 px, the largest.")).toBeAttached();
});

for (const width of [320, 390]) {
  test(`keeps the phone switcher, Actions, Files, and keys reachable at ${width}px`, async ({
    page,
  }) => {
    const address = process.env.E2E_SSHD_ADDR!;
    const separator = address.lastIndexOf(":");
    await page.setViewportSize({ width, height: 520 });
    await page.goto("/");
    await page.getByLabel(/^Host$/i).fill(address.slice(0, separator));
    await page.getByLabel(/^Port$/i).fill(address.slice(separator + 1));
    await page.getByLabel(/^Username$/i).fill("tester");
    await page.getByLabel(/^Password$/i).fill("s3cret");
    await page.getByRole("button", { name: /^Connect to server$/i }).tap();
    await page.getByRole("button", { name: /trust and connect/i }).tap();

    const target = page.getByRole("button", { name: "Open terminals" });
    const actions = page.getByRole("button", { name: "Actions" });
    const bar = page.getByRole("toolbar", { name: "Terminal keys" });
    await expect(target).toBeVisible();
    await expect(bar).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Open terminals" })).toHaveCount(0);
    const targetBox = (await target.boundingBox())!;
    const actionsBox = (await actions.boundingBox())!;
    const barBox = (await bar.boundingBox())!;
    expect(targetBox.width).toBeGreaterThanOrEqual(44);
    expect(targetBox.height).toBeGreaterThanOrEqual(44);
    expect(actionsBox.width).toBeGreaterThanOrEqual(44);
    expect(targetBox.x + targetBox.width).toBeLessThanOrEqual(actionsBox.x + 1);
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(520);

    await target.tap();
    const switcher = page.getByRole("tablist", { name: "Open terminals" });
    await expect(switcher).toBeVisible();
    await expect(switcher.getByRole("button", { name: "New terminal" })).toBeVisible();
    const sheetBox = (await switcher.boundingBox())!;
    expect(sheetBox.x).toBeGreaterThanOrEqual(0);
    expect(sheetBox.x + sheetBox.width).toBeLessThanOrEqual(width);
    await switcher.getByRole("button", { name: "Close", exact: true }).tap();
    await actions.tap();
    await page.getByRole("group", { name: "Actions" }).getByRole("button", { name: "Files" }).tap();
    await expect(page.getByRole("region", { name: "Files" })).toBeVisible();
    await expect(bar).toBeVisible();
    const filesBox = (await page.getByRole("region", { name: "Files" }).boundingBox())!;
    expect(filesBox.y + filesBox.height).toBeLessThanOrEqual(barBox.y + 1);
  });
}

test("phone drags send no hidden shell keys", async ({ page }) => {
  await page.addInitScript(() => {
    const original = WebSocket.prototype.send;
    (window as Window & { sentFrames: number }).sentFrames = 0;
    WebSocket.prototype.send = function (data) {
      (window as Window & { sentFrames: number }).sentFrames++;
      return original.call(this, data);
    };
  });
  const address = process.env.E2E_SSHD_ADDR!;
  const separator = address.lastIndexOf(":");
  await page.goto("/");
  await page.getByLabel(/^Host$/i).fill(address.slice(0, separator));
  await page.getByLabel(/^Port$/i).fill(address.slice(separator + 1));
  await page.getByLabel(/^Username$/i).fill("tester");
  await page.getByLabel(/^Password$/i).fill("s3cret");
  await page.getByRole("button", { name: /^Connect to server$/i }).tap();
  await page.getByRole("button", { name: /trust and connect/i }).tap();
  await expect(page.getByRole("button", { name: "Open terminals" })).toBeVisible();

  const before = await page.evaluate(() => (window as Window & { sentFrames: number }).sentFrames);
  await page.locator(".xterm-screen").evaluate((screen) => {
    const box = screen.getBoundingClientRect();
    for (const [dx, dy] of [
      [70, 0],
      [-70, 0],
      [0, -90],
      [0, 90],
    ]) {
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      for (const [type, px, py] of [
        ["pointerdown", x, y],
        ["pointermove", x + dx, y + dy],
        ["pointerup", x + dx, y + dy],
      ] as const) {
        screen.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 1,
            pointerType: "touch",
            clientX: px,
            clientY: py,
          }),
        );
      }
    }
  });
  expect(await page.evaluate(() => (window as Window & { sentFrames: number }).sentFrames)).toBe(
    before,
  );
});

test("swipes stay silent in phone landscape and after rotation to portrait", async ({ page }) => {
  await page.addInitScript(() => {
    const original = WebSocket.prototype.send;
    (window as Window & { sentFrames: number }).sentFrames = 0;
    WebSocket.prototype.send = function (data) {
      (window as Window & { sentFrames: number }).sentFrames++;
      return original.call(this, data);
    };
  });
  await page.setViewportSize({ width: 844, height: 390 });
  const address = process.env.E2E_SSHD_ADDR!;
  const separator = address.lastIndexOf(":");
  await page.goto("/");
  await page.getByLabel(/^Host$/i).fill(address.slice(0, separator));
  await page.getByLabel(/^Port$/i).fill(address.slice(separator + 1));
  await page.getByLabel(/^Username$/i).fill("tester");
  await page.getByLabel(/^Password$/i).fill("s3cret");
  await page.getByRole("button", { name: /^Connect to server$/i }).tap();
  await page.getByRole("button", { name: /trust and connect/i }).tap();
  await expect(page.locator(".xterm-screen")).toBeVisible();
  const landscapeBefore = await page.evaluate(
    () => (window as Window & { sentFrames: number }).sentFrames,
  );
  await page.locator(".xterm-screen").evaluate((screen) => {
    const box = screen.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    for (const [type, px] of [
      ["pointerdown", x],
      ["pointermove", x + 70],
      ["pointerup", x + 70],
    ] as const) {
      screen.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 1,
          pointerType: "touch",
          clientX: px,
          clientY: y,
        }),
      );
    }
  });
  expect(await page.evaluate(() => (window as Window & { sentFrames: number }).sentFrames)).toBe(
    landscapeBefore,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );

  const before = await page.evaluate(() => (window as Window & { sentFrames: number }).sentFrames);
  await page.locator(".xterm-screen").evaluate((screen) => {
    const box = screen.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    for (const [type, px] of [
      ["pointerdown", x],
      ["pointermove", x + 70],
      ["pointerup", x + 70],
    ] as const) {
      screen.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 1,
          pointerType: "touch",
          clientX: px,
          clientY: y,
        }),
      );
    }
  });
  expect(await page.evaluate(() => (window as Window & { sentFrames: number }).sentFrames)).toBe(
    before,
  );
});

// Keep-alive Off keeps the session on v1, so a dropped socket ends it for good.
for (const cause of ["network", "background"] as const) {
  test(`replaces the key bar with the recovery row after ${cause} loss`, async ({ page }) => {
    const address = process.env.E2E_SSHD_ADDR!;
    const separator = address.lastIndexOf(":");
    await page.addInitScript(() => {
      localStorage.setItem("terminalSettings", JSON.stringify({ keepAlive: "off" }));
      const Original = window.WebSocket;
      const sockets: WebSocket[] = [];
      Object.assign(window, { testSockets: sockets });
      window.WebSocket = class extends Original {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          sockets.push(this);
        }
      };
    });
    await page.goto("/");
    await page.getByLabel(/^Host$/i).fill(address.slice(0, separator));
    await page.getByLabel(/^Port$/i).fill(address.slice(separator + 1));
    await page.getByLabel(/^Username$/i).fill("tester");
    await page.getByLabel(/^Password$/i).fill("s3cret");
    await page.getByRole("button", { name: /^Connect to server$/i }).tap();
    await page.getByRole("button", { name: /trust and connect/i }).tap();

    const bar = page.getByRole("toolbar", { name: "Terminal keys" });
    await expect(bar).toBeVisible();
    await page.locator(".xterm-screen").tap();
    await page.keyboard.type("before-close");
    await expect(page.locator(".xterm-rows")).toContainText("before-close", { timeout: 5_000 });

    await page.evaluate((background) => {
      if (background) window.dispatchEvent(new Event("pagehide"));
      (window as unknown as { testSockets: WebSocket[] }).testSockets.at(-1)?.close();
      if (background) window.dispatchEvent(new Event("pageshow"));
    }, cause === "background");

    const reconnect = page.getByRole("button", { name: "Reconnect" });
    await expect(reconnect).toBeVisible();
    await expect(bar).toBeHidden();
    await expect(page.getByRole("button", { name: "Open terminals" })).toContainText(
      "Disconnected",
    );
    const hint = page.getByText(/start them in tmux or screen/);
    if (cause === "background") {
      await expect(
        page.getByText("The connection closed while localssh was in the background."),
      ).toBeVisible();
      await expect(hint).toBeVisible();
    } else {
      await expect(
        page.locator(".recovery-row").getByText("The connection to the server was lost."),
      ).toBeVisible();
      await expect(hint).toHaveCount(0);
    }
    const close = page.getByRole("button", { name: "Close terminal" });
    for (const button of [reconnect, close]) {
      const box = (await button.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }

    await page.getByRole("button", { name: "Actions" }).tap();
    await page.getByRole("button", { name: "Select text" }).tap();
    await expect(page.getByRole("dialog", { name: "Select text" })).toContainText("before-close");
  });
}

for (const [width, visibleKeys] of [
  [320, 4],
  [390, 5],
] as const) {
  test(`fits the key row to ${width}px and opens More keys`, async ({ page }) => {
    const address = process.env.E2E_SSHD_ADDR!;
    const separator = address.lastIndexOf(":");
    await page.setViewportSize({ width, height: 700 });
    await page.goto("/");
    await page.getByLabel(/^Host$/i).fill(address.slice(0, separator));
    await page.getByLabel(/^Port$/i).fill(address.slice(separator + 1));
    await page.getByLabel(/^Username$/i).fill("tester");
    await page.getByLabel(/^Password$/i).fill("s3cret");
    await page.getByRole("button", { name: /^Connect to server$/i }).tap();
    await page.getByRole("button", { name: /trust and connect/i }).tap();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();

    const bar = page.getByRole("toolbar", { name: "Terminal keys" });
    await expect(bar).toBeVisible();

    // Keyboard, the keys that fit, and More keys; nothing scrolls sideways.
    await expect(bar.getByTestId("key-bar-row").getByRole("button")).toHaveCount(visibleKeys);
    await expect(bar.getByRole("button")).toHaveCount(visibleKeys + 2);
    const noScroll = await page.evaluate(() => {
      const bar = document.querySelector<HTMLElement>(".key-bar")!;
      return {
        bar: bar.scrollWidth <= bar.clientWidth,
        page: document.documentElement.scrollWidth <= window.innerWidth,
      };
    });
    expect(noScroll).toEqual({ bar: true, page: true });

    const more = page.getByRole("button", { name: "More keys" });
    await more.tap();
    const panel = page.getByRole("group", { name: "More keys" });
    await expect(panel).toBeVisible();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".xterm-helper-textarea")).not.toBeFocused();

    // A key in the panel sends, and the panel stays open.
    await panel
      .getByRole("button", { name: /^(hyphen|slash|tilde|pipe)$/i })
      .first()
      .tap();
    await expect(panel).toBeVisible();
    const box = (await panel.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(700 * 0.4 + 1);

    // Escape on a hardware keyboard returns focus to More keys.
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(more).toBeFocused();

    await more.tap();
    await expect(panel).toBeVisible();
    await page.getByRole("button", { name: "Actions" }).tap();
    await page.getByRole("group", { name: "Actions" }).getByRole("button", { name: "Files" }).tap();
    await expect(panel).toHaveCount(0);
  });
}

test("portrait header and Open terminals rows leave room around Connected", async ({ page }) => {
  const address = process.env.E2E_SSHD_ADDR!;
  const separator = address.lastIndexOf(":");
  await page.goto("/");
  await page.getByLabel(/^Host$/i).fill(address.slice(0, separator));
  await page.getByLabel(/^Port$/i).fill(address.slice(separator + 1));
  await page.getByLabel(/^Username$/i).fill("tester");
  await page.getByLabel(/^Password$/i).fill("s3cret");
  await page.getByRole("button", { name: /^Connect to server$/i }).tap();
  await page.getByRole("button", { name: /trust and connect/i }).tap();

  const target = page.getByRole("button", { name: "Open terminals" });
  await expect(target).toContainText("Connected");
  const header = await target.evaluate((button) => {
    const status = button.querySelector(".connection-status")!.getBoundingClientRect();
    const host = button.querySelector(".active-target")!.getBoundingClientRect();
    return { gap: host.top - status.bottom };
  });
  expect(header.gap).toBeGreaterThanOrEqual(4);

  await target.tap();
  const row = page.locator(".terminal-tabs--switcher .terminal-tabs__item").first();
  await expect(row).toBeVisible();
  const spacing = await row.evaluate((item) => {
    const box = item.getBoundingClientRect();
    const tab = item.querySelector('[role="tab"]')!.getBoundingClientRect();
    const host = item.querySelector(".terminal-tabs__host")!.getBoundingClientRect();
    const state = item.querySelector(".terminal-tabs__phone-state")!.getBoundingClientRect();
    return { top: host.top - tab.top, bottom: box.bottom - state.bottom };
  });
  expect(spacing.top).toBeGreaterThanOrEqual(8);
  expect(spacing.bottom).toBeGreaterThanOrEqual(8);
});
