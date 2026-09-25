import { expect, test, type Page } from "@playwright/test";

// A phone, where selecting text is a long press and copying it means reaching
// the Clipboard menu, which dismisses the on-screen keyboard on the way.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

/**
 * Long-presses at one point and drags to another with real touch input, so the
 * page sees the pointer stream a phone produces.
 */
async function longPressDrag(page: Page, from: Point, to: Point) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
  await page.waitForTimeout(700);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [to] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

interface Point {
  x: number;
  y: number;
}

async function connect(page: Page) {
  const sshdAddress = process.env.E2E_SSHD_ADDR;
  expect(sshdAddress, "global setup must provide the SSH server address").toBeTruthy();

  const separator = sshdAddress!.lastIndexOf(":");
  await page.goto("/");
  await page.getByLabel(/^Host$/i).fill(sshdAddress!.slice(0, separator));
  await page.getByLabel(/^Port$/i).fill(sshdAddress!.slice(separator + 1));
  await page.getByLabel(/^Username$/i).fill("tester");
  await page.getByLabel(/^Password$/i).fill("s3cret");
  await page.getByRole("button", { name: /^Connect$/i }).tap();
  await page.getByRole("button", { name: /trust and connect/i }).tap();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
}

test("a touch selection survives the keyboard closing and can be copied", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await connect(page);

  await page.keyboard.type("selectme");
  await expect(page.locator(".xterm-rows")).toContainText("selectme", { timeout: 5_000 });

  // Long press on the first row, then drag along it.
  const screen = (await page.locator(".xterm-screen").boundingBox())!;
  const rowY = screen.y + 5;
  await longPressDrag(
    page,
    { x: screen.x + 2, y: rowY },
    { x: screen.x + screen.width / 2, y: rowY },
  );

  const clipboard = page.getByRole("button", { name: /^clipboard/i });
  await expect(clipboard).toHaveAccessibleName(/selection ready to copy/i);

  // The keyboard closing grows the visual viewport, which changes the row count.
  await page.setViewportSize({ width: 390, height: 600 });
  await page.waitForTimeout(300);
  await expect(clipboard).toHaveAccessibleName(/selection ready to copy/i);

  await clipboard.tap();
  await page.getByRole("button", { name: /^copy selection$/i }).tap();
  await expect(page.getByText("Copied the selection.")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("selectme");
});

test("a touch the browser cancels is not taken as a tap", async ({ page }) => {
  await connect(page);
  const terminalInput = page.locator(".xterm-helper-textarea");
  await terminalInput.blur();
  await expect(terminalInput).not.toBeFocused();

  const screen = (await page.locator(".xterm-screen").boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: screen.x + 20, y: screen.y + 20 }],
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await cdp.detach();

  await page.waitForTimeout(300);
  await expect(terminalInput).not.toBeFocused();
});
