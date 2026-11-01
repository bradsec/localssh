import { mkdirSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

for (const viewport of [
  { width: 320, height: 700 },
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  test(`keeps the connect action in view at ${viewport.width}px`, async ({ browser }) => {
    const page = await browser.newPage({ viewport });
    await page.goto("/");
    await expect(page.getByRole("button", { name: /^Connect to server$/i })).toBeInViewport();
    await page.getByRole("heading", { name: "Saved hosts" }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("heading", { name: "Saved hosts" })).toBeInViewport();
    await page.close();
  });

  test(`keeps Help readable at ${viewport.width}px`, async ({ browser }) => {
    const page = await browser.newPage({ viewport });
    await page.goto("/");
    await page.getByRole("button", { name: "Help" }).click();
    const panel = page.locator(".help__panel");
    await expect(panel.getByRole("heading", { name: "Help with localssh" })).toBeVisible();
    const bounds = await panel.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        width: element.clientWidth,
        scroll: element.scrollWidth,
      };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(viewport.width);
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
    await page.close();
  });
}

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
  await page.getByRole("button", { name: /^Connect to server$/i }).click();

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

test("uploads and downloads a file through the relay", async ({ page }) => {
  const address = process.env.E2E_SSHD_ADDR!;
  await page.goto("/");
  await page.getByLabel(/^Host$/i).fill(address.slice(0, address.lastIndexOf(":")));
  await page.getByLabel(/^Port$/i).fill(address.slice(address.lastIndexOf(":") + 1));
  await page.getByLabel(/^Username$/i).fill("tester");
  await page.getByLabel(/^Password$/i).fill("s3cret");
  await page.getByRole("button", { name: /^Connect to server$/i }).click();
  await page.getByRole("button", { name: /trust and connect/i }).click();
  await page.getByRole("button", { name: "Files" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("region", { name: "Files" })).toBeInViewport();
  await expect(
    page.getByText("No files in this directory. Choose another path or upload a file."),
  ).toBeVisible();
  await page.getByLabel("Remote path").fill("/missing");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(
    page.getByText("Cannot open /missing: no such file. Check the remote path."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Learn more about files" }).click();
  await expect(page.getByRole("heading", { name: "Browse and transfer files" })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByLabel("Remote path").fill(".");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByText("Current folder: /", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Up to parent folder" })).toBeDisabled();
  await page.getByLabel("Upload file").setInputFiles({
    name: "sample.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("SFTP round trip"),
  });
  await expect(page.getByText("Uploaded sample.txt.")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download file sample.txt" }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe("sample.txt");
  await expect(page.getByRole("link", { name: "Save download" })).toBeVisible();
  const stream = await saved.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toBe("SFTP round trip");
  await page.getByLabel("Upload file").setInputFiles({
    name: "sample.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("replacement"),
  });
  await expect(page.getByRole("alertdialog", { name: "Replace file" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("alertdialog", { name: "Replace file" })).not.toBeVisible();
  await page.getByLabel("Upload file").setInputFiles({
    name: "sample.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("replacement"),
  });
  await page.getByRole("button", { name: "Replace file" }).click();
  await expect(page.getByText("Uploaded sample.txt.")).toBeVisible();
  const replacementDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download file sample.txt" }).click();
  const replaced = await replacementDownload;
  const replacementStream = await replaced.createReadStream();
  const replacementChunks: Buffer[] = [];
  for await (const chunk of replacementStream) replacementChunks.push(Buffer.from(chunk));
  expect(Buffer.concat(replacementChunks).toString()).toBe("replacement");

  const root = process.env.E2E_SFTP_ROOT!;
  mkdirSync(path.join(root, "logs"));
  writeFileSync(path.join(root, "logs", "app.log"), "log line");
  symlinkSync("logs", path.join(root, "logs-link"));
  symlinkSync("missing", path.join(root, "broken-link"));
  await page.getByRole("button", { name: "Open", exact: true }).click();
  const files = page.getByRole("region", { name: "Files" });
  await expect(files.getByRole("listitem").filter({ hasText: "logs-link" })).toContainText(
    "Link to folder",
  );
  await expect(files.getByRole("listitem").filter({ hasText: "broken-link" })).toContainText(
    "Broken link",
  );
  await page.getByRole("button", { name: "logs-link/" }).click();
  await expect(page.getByText("Current folder: /logs-link", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download file app.log" })).toBeVisible();
  await page.getByRole("button", { name: "Up to parent folder" }).click();
  await expect(page.getByText("Current folder: /", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download file sample.txt" })).toBeVisible();
  expect(readdirSync(root).filter((name) => name.startsWith(".localssh-upload-"))).toEqual([]);
  await page.getByRole("button", { name: "Close files" }).click();
  await page.locator(".xterm-screen").click();
  await page.keyboard.type("terminal-still-open");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText("terminal-still-open");
});

test("keeps two live terminal sessions and closes only the selected one", async ({ page }) => {
  const address = process.env.E2E_SSHD_ADDR!;
  const host = address.slice(0, address.lastIndexOf(":"));
  const port = address.slice(address.lastIndexOf(":") + 1);
  await page.goto("/");

  const open = async () => {
    await page.getByLabel(/^Host$/i).fill(host);
    await page.getByLabel(/^Port$/i).fill(port);
    await page.getByLabel(/^Username$/i).fill("tester");
    await page.getByLabel(/^Password$/i).fill("s3cret");
    await page.getByRole("button", { name: /^Connect to server$/i }).click();
  };

  await open();
  await page.getByRole("button", { name: /trust and connect/i }).click();
  await expect(page.getByRole("tab", { name: `${host}, connected` })).toHaveCount(1);
  const first = page.getByRole("tabpanel", { name: `${host} terminal` }).first();
  await first.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("first-shell");
  await page.keyboard.press("Enter");
  await expect(first.locator(".xterm-rows")).toContainText("first-shell");

  await page.getByRole("button", { name: "New terminal" }).click();
  await open();
  await expect(page.getByRole("tab", { name: `${host}, connected` })).toHaveCount(2);
  const second = page.getByRole("tabpanel", { name: `${host} terminal` }).last();
  await second.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("second-shell");
  await page.keyboard.press("Enter");
  await expect(second.locator(".xterm-rows")).toContainText("second-shell");
  await expect(second.locator(".xterm-rows")).not.toContainText("first-shell");

  await page.keyboard.press("Control+Alt+Shift+ArrowLeft");
  await expect(page.getByRole("tab", { name: `${host}, connected` }).first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  const tabSize = await page
    .getByRole("tab", { name: `${host}, connected` })
    .first()
    .boundingBox();
  expect(tabSize!.height).toBeGreaterThanOrEqual(44);

  await page
    .getByRole("button", { name: `Close ${host} terminal` })
    .last()
    .click();
  await expect(page.getByRole("tab", { name: `${host}, connected` })).toHaveCount(1);
  await expect(first.locator(".xterm-rows")).toContainText("first-shell");
});

test("connects with a private-key file through the relay", async ({ page }) => {
  const address = process.env.E2E_SSHD_ADDR!;
  await page.goto("/");
  await page.getByLabel(/^Host$/i).fill(address.slice(0, address.lastIndexOf(":")));
  await page.getByLabel(/^Port$/i).fill(address.slice(address.lastIndexOf(":") + 1));
  await page.getByLabel(/^Username$/i).fill("tester");
  await page.getByLabel(/^Private key$/i).check();
  await page.getByLabel(/^Private-key file$/i).setInputFiles(process.env.E2E_KEY_PATH!);
  await page.getByRole("button", { name: /^Connect to server$/i }).click();
  await expect(page.getByRole("alertdialog", { name: /verify host key/i })).toBeVisible();
  await page.getByRole("button", { name: /trust and connect/i }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page.locator(".xterm-screen").click();
  await page.keyboard.type("key-login");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText("key-login");
});

test("reports wrong passphrase and rejected key", async ({ page }) => {
  const address = process.env.E2E_SSHD_ADDR!;
  await page.goto("/");
  await page.getByLabel(/^Host$/i).fill(address.slice(0, address.lastIndexOf(":")));
  await page.getByLabel(/^Port$/i).fill(address.slice(address.lastIndexOf(":") + 1));
  await page.getByLabel(/^Username$/i).fill("tester");
  await page.getByLabel(/^Private key$/i).check();
  await page.getByLabel(/^Private-key file$/i).setInputFiles(process.env.E2E_REJECTED_KEY_PATH!);
  await page.getByLabel(/^Key passphrase$/i).fill("wrong");
  await page.getByRole("button", { name: /^Connect to server$/i }).click();
  await expect(page.getByText(/key passphrase did not unlock this key/i)).toBeVisible();
  await page.getByLabel(/^Private-key file$/i).setInputFiles(process.env.E2E_REJECTED_KEY_PATH!);
  await page.getByLabel(/^Key passphrase$/i).fill("secret");
  await page.getByRole("button", { name: /^Connect to server$/i }).click();
  await expect(page.getByRole("alertdialog", { name: /verify host key/i })).toBeVisible();
  await page.getByRole("button", { name: /trust and connect/i }).click();
  await expect(page.getByText("The server did not accept this key.")).toBeVisible();
});

test("keeps the session target clear of the Actions button at 320px", async ({ browser }) => {
  const address = process.env.E2E_SSHD_ADDR!;
  const page = await browser.newPage({ viewport: { width: 320, height: 640 } });
  await page.goto("/");
  await page.getByLabel(/^Host$/i).fill(address.slice(0, address.lastIndexOf(":")));
  await page.getByLabel(/^Port$/i).fill(address.slice(address.lastIndexOf(":") + 1));
  await page.getByLabel(/^Username$/i).fill("tester");
  await page.getByLabel(/^Password$/i).fill("s3cret");
  await page.getByRole("button", { name: /^Connect to server$/i }).click();
  await page.getByRole("button", { name: /trust and connect/i }).click();
  const target = page.locator(".active-target");
  await expect(target).toHaveText(`tester@${address}`);
  const text = await target.boundingBox();
  const actions = await page.getByRole("button", { name: "Actions" }).boundingBox();
  expect(text!.x + text!.width).toBeLessThanOrEqual(actions!.x);
  expect(await target.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.close();
});

for (const width of [320, 390]) {
  test(`keeps toolbar panels on screen at ${width}px`, async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width, height: 700 } });
    await page.goto("/");
    for (const [name, panel] of [
      ["Appearance", ".terminal-settings fieldset"],
      ["About", ".about__panel"],
    ] as const) {
      await page.getByRole("button", { name, exact: true }).click();
      const box = await page.locator(panel).boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await page.reload();
    }
    await page.close();
  });
}
