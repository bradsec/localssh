import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
});

test("font family change measures the loaded font", async ({ page }) => {
  const address = process.env.E2E_SSHD_ADDR!;
  let releaseFont!: () => void;
  const fontGate = new Promise<void>((resolve) => (releaseFont = resolve));
  let fontRequested!: () => void;
  const requested = new Promise<void>((resolve) => (fontRequested = resolve));
  await page.route("**/*fira-code*400-normal*.woff2", async (route) => {
    fontRequested();
    await fontGate;
    await route.continue();
  });

  await page.goto("/");
  await page.getByLabel(/^Host$/i).fill(address.slice(0, address.lastIndexOf(":")));
  await page.getByLabel(/^Port$/i).fill(address.slice(address.lastIndexOf(":") + 1));
  await page.getByLabel(/^Username$/i).fill("tester");
  await page.getByLabel(/^Password$/i).fill("s3cret");
  await page.getByRole("button", { name: /^Connect to server$/i }).tap();
  await page.getByRole("button", { name: /trust and connect/i }).tap();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Actions" }).tap();
  await page.getByRole("button", { name: "Settings" }).tap();
  await page.getByLabel("Font family").selectOption('"Fira Code", monospace');
  await requested;

  const row = page.locator(".xterm-rows > div").first();
  const before = await row.evaluate((element) => element.getBoundingClientRect().height);
  releaseFont();
  await page.evaluate(() => document.fonts.load('14px "Fira Code"'));
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const after = await row.evaluate((element) => element.getBoundingClientRect().height);
  await page.getByLabel("Font family").selectOption("monospace");
  await page.getByLabel("Font family").selectOption('"Fira Code", monospace');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const reselected = await row.evaluate((element) => element.getBoundingClientRect().height);
  console.log({ before, after, reselected });
  expect(before).not.toBe(reselected);
  expect(after).toBe(reselected);
});

test("line height applies live, refits the PTY and survives reload", async ({ page }) => {
  // Records every PTY resize the page sends through the engine handle.
  await page.addInitScript(() => {
    type Handle = { resize: (cols: number, rows: number) => void };
    type Connect = (...args: unknown[]) => Promise<Handle>;
    const resizes: { cols: number; rows: number }[] = [];
    (window as unknown as { ptyResizes: typeof resizes }).ptyResizes = resizes;
    let wrapped: Connect | undefined;
    Object.defineProperty(window, "sshConnect", {
      configurable: true,
      get: () => wrapped,
      set: (connect: Connect) => {
        wrapped = async (...args) => {
          const handle = await connect(...args);
          const resize = handle.resize;
          handle.resize = (cols, rows) => {
            resizes.push({ cols, rows });
            resize.call(handle, cols, rows);
          };
          return handle;
        };
      },
    });
  });
  const address = process.env.E2E_SSHD_ADDR!;
  const nextFrames = () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  const lastPtyRows = () =>
    page.evaluate(() => {
      const resizes = (window as unknown as { ptyResizes: { rows: number }[] }).ptyResizes;
      return resizes.at(-1)?.rows;
    });

  const connect = async (trustHostKey: boolean) => {
    await page.getByLabel(/^Host$/i).fill(address.slice(0, address.lastIndexOf(":")));
    await page.getByLabel(/^Port$/i).fill(address.slice(address.lastIndexOf(":") + 1));
    await page.getByLabel(/^Username$/i).fill("tester");
    await page.getByLabel(/^Password$/i).fill("s3cret");
    await page.getByRole("button", { name: /^Connect to server$/i }).tap();
    if (trustHostKey) await page.getByRole("button", { name: /trust and connect/i }).tap();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await nextFrames();
  };

  await page.goto("/");
  await connect(true);

  const row = page.locator(".xterm-rows > div").first();
  const rowHeight = () => row.evaluate((element) => element.getBoundingClientRect().height);
  const beforeHeight = await rowHeight();
  await expect.poll(lastPtyRows).toBeDefined();
  const beforePtyRows = (await lastPtyRows())!;

  await page.getByRole("button", { name: "Actions" }).tap();
  await page.getByRole("button", { name: "Settings" }).tap();
  const picker = page.getByLabel("Line height");
  await expect(picker).toHaveValue("1.15");
  await picker.selectOption("1.50");
  await nextFrames();

  await expect.poll(rowHeight).toBeGreaterThan(beforeHeight);
  await expect.poll(lastPtyRows).toBeLessThan(beforePtyRows);
  const liveHeight = await rowHeight();
  const livePtyRows = await lastPtyRows();

  await page.reload();
  await connect(false);
  await expect.poll(rowHeight).toBe(liveHeight);
  await expect.poll(lastPtyRows).toBe(livePtyRows);
  await page.getByRole("button", { name: "Actions" }).tap();
  await page.getByRole("button", { name: "Settings" }).tap();
  await expect(page.getByLabel("Line height")).toHaveValue("1.50");
});
