import { expect, test } from "@playwright/test";

const MASTER_PASSWORD = "an adequately long master password";

test("saves a host, survives a reload, and connects from the vault", async ({ page }) => {
  const sshdAddress = process.env.E2E_SSHD_ADDR;
  expect(sshdAddress, "global setup must provide the SSH server address").toBeTruthy();

  const separator = sshdAddress!.lastIndexOf(":");
  const sshdHost = sshdAddress!.slice(0, separator);
  const sshdPort = sshdAddress!.slice(separator + 1);

  await page.goto("/");

  // Create the vault.
  await page.getByLabel(/^master password$/i).fill(MASTER_PASSWORD);
  await page.getByLabel(/confirm master password/i).fill(MASTER_PASSWORD);
  await page.getByRole("button", { name: /create/i }).click();
  await expect(page.getByText(/no saved hosts yet/i)).toBeVisible({ timeout: 15_000 });

  // Save a full entry.
  await page.getByRole("button", { name: /add current/i }).click();
  const savedHosts = page.getByRole("region", { name: /saved hosts/i });
  await savedHosts.getByLabel(/nickname/i).fill("test box");
  await savedHosts.getByLabel(/^host$/i).fill(sshdHost);
  await savedHosts.getByLabel(/^port$/i).fill(sshdPort);
  await savedHosts.getByRole("radio", { name: /host, username and password/i }).click();
  await savedHosts.getByLabel(/^username$/i).fill("tester");
  await savedHosts.getByLabel(/^password$/i).fill("s3cret");
  await savedHosts.getByRole("button", { name: /^save$/i }).click();
  await expect(page.getByRole("button", { name: /^test box:/i })).toBeVisible();

  // The stored blob must not contain the password in plain text.
  const stored = await page.evaluate(() => localStorage.getItem("vault"));
  expect(stored).toBeTruthy();
  expect(stored).not.toContain("s3cret");
  expect(stored).not.toContain("tester");
  expect(stored).not.toContain("test box");

  // A reload re-locks the vault.
  await page.reload();
  await expect(page.getByRole("button", { name: /^unlock$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /^test box:/i })).toHaveCount(0);

  await page.getByLabel(/^master password$/i).fill(MASTER_PASSWORD);
  await page.getByRole("button", { name: /^unlock$/i }).click();
  await expect(page.getByRole("button", { name: /^test box:/i })).toBeVisible({
    timeout: 15_000,
  });

  // Unlock loads the WASM engine and defines sshConnect. Intercept only after
  // that point, otherwise the wrapper captures undefined.
  await page.evaluate(() => {
    const original = window.sshConnect;
    (window as unknown as { __passwordArg?: unknown }).__passwordArg = undefined;
    window.sshConnect = ((...args: unknown[]) => {
      (window as unknown as { __passwordArg?: unknown }).__passwordArg = args[4];
      return original(...(args as Parameters<typeof original>));
    }) as typeof window.sshConnect;
  });

  await page.getByRole("button", { name: /^test box:/i }).click();

  const hostKeyPrompt = page.getByRole("alertdialog", { name: /verify host key/i });
  await expect(hostKeyPrompt).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /trust and connect/i }).click();

  await expect(page.getByText("Connected", { exact: true })).toBeVisible();

  const passwordArg = await page.evaluate(
    () => (window as unknown as { __passwordArg?: unknown }).__passwordArg,
  );
  expect(passwordArg).toEqual({ fromVault: expect.any(String) });
});

test("a wrong master password does not unlock the vault", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel(/^master password$/i).fill(MASTER_PASSWORD);
  await page.getByLabel(/confirm master password/i).fill(MASTER_PASSWORD);
  await page.getByRole("button", { name: /create/i }).click();
  await expect(page.getByText(/no saved hosts yet/i)).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await page.getByLabel(/^master password$/i).fill("not the master password");
  await page.getByRole("button", { name: /^unlock$/i }).click();

  await expect(page.getByRole("alert")).toContainText(/not correct/i, { timeout: 15_000 });
  await expect(page.getByRole("button", { name: /^unlock$/i })).toBeVisible();
});
