import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  globalSetup: "./playwright/global-setup.ts",
  webServer: {
    command:
      "../engine/build.sh && npm run build && npm run preview -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    env: { VITE_RELAY_WS_URL: "ws://127.0.0.1:8787" },
    gracefulShutdown: { signal: "SIGTERM", timeout: 2_000 },
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
  },
});
