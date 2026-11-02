import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function connect(page: Page) {
  const sshdAddress = process.env.E2E_SSHD_ADDR;
  expect(sshdAddress, "global setup must provide the SSH server address").toBeTruthy();

  const separator = sshdAddress!.lastIndexOf(":");
  await page.goto("/");
  await page.getByLabel(/^Host$/i).fill(sshdAddress!.slice(0, separator));
  await page.getByLabel(/^Port$/i).fill(sshdAddress!.slice(separator + 1));
  await page.getByLabel(/^Username$/i).fill("tester");
  await page.getByLabel(/^Password$/i).fill("s3cret");
  await page.getByRole("button", { name: /^Connect to server$/i }).tap();
  await page.getByRole("button", { name: /trust and connect/i }).tap();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
}

test("Select text shows frozen DOM output and blocks shell input", async ({ page }) => {
  await connect(page);
  await page
    .locator(".xterm-helper-textarea")
    .evaluate((textarea: HTMLTextAreaElement) => textarea.focus());
  await page.keyboard.type("selectme");
  await expect(page.locator(".xterm-rows")).toContainText("selectme");

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

test("stationary long press opens the text view", async ({ page }) => {
  await connect(page);
  await page.locator(".xterm-screen").evaluate((screen) => {
    const bounds = screen.getBoundingClientRect();
    screen.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 1,
        pointerType: "touch",
        clientX: bounds.left + 8,
        clientY: bounds.top + 8,
      }),
    );
  });
  await expect(page.getByRole("dialog", { name: "Select text" })).toBeVisible();
});
