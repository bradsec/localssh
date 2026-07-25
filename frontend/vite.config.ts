import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// A production bundle carries whatever relay URL it was built with, and a
// wrong one only surfaces as a failed connection in someone's browser. These
// warn at build time about the two mistakes that matter: shipping the
// localhost development default, and shipping a plaintext ws:// URL that an
// HTTPS page refuses to open as mixed content.
//
// Warnings, not errors, so `npm run build` keeps working without any
// environment set up.
function warnAboutRelayUrl(rawUrl: string | undefined): void {
  const prefix = "[localssh] VITE_RELAY_WS_URL";

  if (!rawUrl) {
    console.warn(
      `${prefix} is not set, so this build falls back to the ws://127.0.0.1:8787 ` +
        "development default. Set it to your relay's wss:// URL before deploying.",
    );
    return;
  }

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
  return { plugins: [react()] };
});
