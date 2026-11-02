import { expect, test } from "@playwright/test";

const OLD_TEAL = [
  "#245d6b",
  "#1b4a55",
  "#75c1d1",
  "#95d2de",
  "#151c1e",
  "#1d2729",
  "#263235",
  "#f6f8f7",
  "#ecf1f0",
  "#342326",
];

test.describe("Home Screen app and palette", () => {
  test("links a valid manifest and Home Screen head tags", async ({ page, request }) => {
    await page.goto("/");

    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(manifestHref).toBe("/manifest.webmanifest");
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      "href",
      "/apple-touch-icon.png",
    );
    for (const [name, content] of [
      ["apple-mobile-web-app-capable", "yes"],
      ["apple-mobile-web-app-title", "localssh"],
      ["apple-mobile-web-app-status-bar-style", "default"],
    ]) {
      await expect(page.locator(`meta[name="${name}"]`)).toHaveAttribute("content", content!);
    }
    await expect(page.locator('meta[name="theme-color"][media*="light"]')).toHaveAttribute(
      "content",
      "#ffffff",
    );
    await expect(page.locator('meta[name="theme-color"][media*="dark"]')).toHaveAttribute(
      "content",
      "#1e202b",
    );

    const response = await request.get(manifestHref!);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/manifest\+json|application\/json/);
    const manifest = await response.json();
    expect(manifest).toMatchObject({
      name: "localssh",
      start_url: "/",
      scope: "/",
      display: "standalone",
    });
    expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes).sort()).toEqual([
      "192x192",
      "512x512",
      "512x512",
    ]);
    expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === "maskable")).toBe(
      true,
    );

    const icons = [
      ...manifest.icons.map((icon: { src: string }) => icon.src),
      "/apple-touch-icon.png",
    ];
    for (const src of icons) {
      const icon = await request.get(src);
      expect(icon.status(), src).toBe(200);
      expect(icon.headers()["content-type"], src).toBe("image/png");
    }
  });

  test("built CSS carries no teal accent or surface values", async ({ page, request }) => {
    await page.goto("/");
    const sheets = await page
      .locator('link[rel="stylesheet"]')
      .evaluateAll((links) => links.map((link) => (link as HTMLLinkElement).href));
    expect(sheets.length).toBeGreaterThan(0);

    let css = "";
    for (const href of sheets) css += (await (await request.get(href)).text()).toLowerCase();

    for (const hex of OLD_TEAL) expect(css, hex).not.toContain(hex);
    for (const hex of ["#3a4fbf", "#8fa3f7", "#1e202b", "#15161e"]) {
      expect(css, hex).toContain(hex);
    }
  });
});

test.describe("key row fills to More", () => {
  test.use({ hasTouch: true, isMobile: true });

  for (const width of [390, 320]) {
    test(`no dead space before More at ${width}px`, async ({ page }) => {
      const address = process.env.E2E_SSHD_ADDR!;
      const separator = address.lastIndexOf(":");
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/");
      await page.getByLabel(/^Host$/i).fill(address.slice(0, separator));
      await page.getByLabel(/^Port$/i).fill(address.slice(separator + 1));
      await page.getByLabel(/^Username$/i).fill("tester");
      await page.getByLabel(/^Password$/i).fill("s3cret");
      await page.getByRole("button", { name: /^Connect to server$/i }).tap();
      await page.getByRole("button", { name: /trust and connect/i }).tap();
      await expect(page.getByText("Connected", { exact: true })).toBeVisible();

      const row = page.getByTestId("key-bar-row");
      await expect(row.locator("button").first()).toBeVisible();
      const measured = await page.evaluate(() => {
        const rowBox = document.querySelector('[data-testid="key-bar-row"]')!;
        const rect = rowBox.getBoundingClientRect();
        const keys = [...rowBox.querySelectorAll("button")].map((key) =>
          key.getBoundingClientRect(),
        );
        const more = document.querySelector(".key-bar__key--more")!.getBoundingClientRect();
        return {
          rowRight: rect.right,
          moreLeft: more.left,
          widths: keys.map((key) => key.width),
          lastRight: keys.at(-1)!.right,
        };
      });
      expect(measured.widths.length).toBeGreaterThanOrEqual(3);
      for (const keyWidth of measured.widths) expect(keyWidth).toBeGreaterThanOrEqual(44);
      // The last key ends where the row does, and the row ends one gap before More.
      expect(measured.rowRight - measured.lastRight).toBeLessThanOrEqual(1);
      expect(measured.moreLeft - measured.lastRight).toBeLessThanOrEqual(5);
    });
  }
});
