import { expect, test, type Page } from "@playwright/test";

function sshdTarget(): { host: string; port: string } {
  const address = process.env.E2E_SSHD_ADDR;
  expect(address, "global setup must provide the SSH server address").toBeTruthy();
  const separator = address!.lastIndexOf(":");
  return { host: address!.slice(0, separator), port: address!.slice(separator + 1) };
}

async function fillConnectForm(page: Page, host: string, port: string, password = "s3cret") {
  await page.getByLabel(/^Host$/i).fill(host);
  await page.getByLabel(/^Port$/i).fill(port);
  await page.getByLabel(/^Username$/i).fill("tester");
  await page.getByLabel(/^Password$/i).fill(password);
  await page.getByRole("button", { name: /^Connect to server$/i }).click();
}

test("opens Help from the connect screen, searches it, and closes with Escape", async ({
  page,
}) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Help" });
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: "Help with localssh" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("searchbox", { name: "Search help" }).fill("fingerprint");
  await expect(dialog.getByRole("heading", { name: "Check the host key" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Save a host" })).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("opens Help during a live session and gives the terminal its focus back", async ({ page }) => {
  const { host, port } = sshdTarget();
  await page.goto("/");
  await fillConnectForm(page, host, port);
  await page.getByRole("button", { name: /trust and connect/i }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();

  const terminalInput = page.locator(".xterm-helper-textarea");
  await expect(terminalInput).toBeFocused();
  await page.getByRole("button", { name: "Help" }).click();
  const dialog = page.getByRole("dialog", { name: "Help with localssh" });
  await dialog.getByRole("navigation", { name: "Help topics" }).getByText("Terminal").click();
  await expect(dialog.getByRole("heading", { name: "Use the terminal" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(terminalInput).toBeFocused();

  await page.keyboard.type("still here");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText("still here", { timeout: 5_000 });
});

test("explains a refused connection and links to the matching Help topic", async ({ page }) => {
  await page.goto("/");
  // Port 1 on loopback has no listener, so the relay's dial is refused.
  await fillConnectForm(page, "127.0.0.1", "1");

  const alert = page.getByRole("alert");
  await alert.getByText("Technical details").click();
  await expect(alert).toContainText("relay connection closed: target connection refused");
  await expect(alert).toContainText("The server refused the connection.");

  await alert.getByRole("button", { name: "Learn more about connection problems" }).click();
  const dialog = page.getByRole("dialog", { name: "Help with localssh" });
  await expect(dialog.getByRole("heading", { name: "Fix a connection problem" })).toBeFocused();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
});

test("keeps target refusal details on a v1 relay", async ({ page }) => {
  await page.route("**/capabilities", (route) =>
    route.fulfill({ json: { resume: false, maxGraceMs: null } }),
  );
  await page.goto("/");
  await fillConnectForm(page, "127.0.0.1", "1");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("The server refused the connection.");
  await alert.getByText("Technical details").click();
  await expect(alert).toContainText("relay connection closed: target connection refused");
});

test("names a failed login as an authentication problem", async ({ page }) => {
  const { host, port } = sshdTarget();
  await page.goto("/");
  await fillConnectForm(page, host, port, "wrong-password");
  const hostKey = page.getByRole("button", { name: /trust and connect/i });
  // A fresh browser context has no known hosts, so the key prompt comes first.
  await hostKey.click();

  await expect(page.getByRole("alert")).toContainText("SSH login failed.");
});

test("keeps the Help dialog inside a phone screen", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 320, height: 568 }, hasTouch: true });
  await page.goto("/");
  await page.getByRole("button", { name: "Help" }).click();
  const panel = page.getByRole("dialog", { name: "Help with localssh" });
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  expect(box!.y + box!.height).toBeLessThanOrEqual(568);
  await expect(panel.getByRole("searchbox", { name: "Search help" })).toBeInViewport();
  await page.close();
});
