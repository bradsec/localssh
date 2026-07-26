import { readFileSync } from "node:fs";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// The version shown in the UI comes from the repository's VERSION file, the same
// value the release workflow tags the images with, so a release updates the page
// without anyone editing a string. Container builds copy only frontend/, so the
// Dockerfile passes the release version in as VITE_APP_VERSION instead.
function resolveAppVersion(): string {
  const fromEnvironment = process.env.VITE_APP_VERSION?.trim();
  if (fromEnvironment) return fromEnvironment;

  try {
    return readFileSync(new URL("../VERSION", import.meta.url), "utf8").trim();
  } catch {
    return "development";
  }
}

// A production bundle uses the same-origin /relay proxy unless an explicit
// relay URL is supplied. A wrong explicit URL only surfaces as a failed
// connection in someone's browser, so warn about invalid or unsafe overrides.
//
// Warnings, not errors, so `npm run build` keeps working without any
// environment set up.
function warnAboutRelayUrl(rawUrl: string | undefined): void {
  const prefix = "[localssh] VITE_RELAY_WS_URL";

  if (!rawUrl) return;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    console.warn(`${prefix} is not a valid URL: ${rawUrl}`);
    return;
  }

  if (url.protocol !== "wss:" && url.protocol !== "ws:") {
    console.warn(`${prefix} should use ws:// or wss://, got ${url.protocol}`);
    return;
  }

  const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol === "ws:" && !isLoopback) {
    console.warn(
      `${prefix} uses plaintext ws:// (${rawUrl}). An HTTPS page blocks that as mixed ` +
        "content, and the relay carries your SSH stream. Prefer wss://.",
    );
  }
}

export default defineConfig(({ mode }) => {
  if (mode === "production") {
    // Read through loadEnv so .env files are honoured, not just the shell.
    warnAboutRelayUrl(loadEnv(mode, process.cwd(), "").VITE_RELAY_WS_URL);
  }
  return {
    plugins: [react()],
    define: {
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(resolveAppVersion()),
    },
  };
});
