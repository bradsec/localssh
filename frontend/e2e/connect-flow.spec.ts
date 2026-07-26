import { expect, test } from "@playwright/test";

test("connects through the relay, trusts the host key, and echoes input", async ({ page }) => {
  const sshdAddress = process.env.E2E_SSHD_ADDR;
  expect(sshdAddress, "global setup must provide the SSH server address").toBeTruthy();

  const separator = sshdAddress!.lastIndexOf(":");
  const sshdHost = sshdAddress!.slice(0, separator);
  const sshdPort = sshdAddress!.slice(separator + 1);

  await page.goto("/");
  const terminalInput = page.locator(".xterm-helper-textarea");
  await expect(terminalInput).toHaveAttribute("tabindex", "-1");
  await expect(page.locator(".xterm-accessibility-tree")).toBeAttached();

  await page.getByLabel(/^Host$/i).fill(sshdHost);
  await page.getByLabel(/^Port$/i).fill(sshdPort);
  await page.getByLabel(/^Username$/i).fill("tester");
  await page.getByLabel(/^Password$/i).fill("s3cret");
  await page.getByRole("button", { name: /^Connect$/i }).click();

  const hostKeyPrompt = page.getByRole("alertdialog", { name: /verify host key/i });
  await expect(hostKeyPrompt).toBeVisible();
  await expect(hostKeyPrompt).toContainText(/SHA256:/);
  await page.getByRole("button", { name: /trust and connect/i }).click();

  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(hostKeyPrompt).not.toBeVisible();
  await expect(terminalInput).toHaveAttribute("tabindex", "0");
  await expect(terminalInput).toBeFocused();

  await page.locator(".xterm-screen").click();
  await page.keyboard.type("hello");
  await page.keyboard.press("Enter");

  await expect(page.locator(".xterm-rows")).toContainText("hello", { timeout: 5_000 });
});
