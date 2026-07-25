import { expect, test } from "@playwright/test";

// A phone, where the terminal keys the bar supplies are the only ones there are.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("supplies terminal keys for the whole session, keyboard or not", async ({ page }) => {
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

  const keyBar = page.getByRole("toolbar", { name: /terminal keys/i });
  const terminalInput = page.locator(".xterm-helper-textarea");

  await expect(keyBar).toBeVisible();

  // The bar has to keep the focus that raised the keyboard, or the keyboard
  // closes under the first key pressed on it.
  await page.getByRole("button", { name: /^tilde$/i }).tap();
  await expect(terminalInput).toBeFocused();
  await expect(page.locator(".xterm-rows")).toContainText("~", { timeout: 5_000 });

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

  await page.getByRole("button", { name: /disconnect/i }).tap();
  await expect(keyBar).toBeHidden();
});
