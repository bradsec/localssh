import { parseAccessConfig } from "../src/access.js";
import { closeLocalRelay, startLocalRelay } from "../src/local-relay.js";

const port = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  console.error(`invalid relay port: ${process.env.PORT ?? ""}`);
  process.exit(1);
}

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1) {
    console.error(`invalid ${name}: ${process.env[name] ?? ""}`);
    process.exit(1);
  }
  return value;
}

let accessConfig;
try {
  accessConfig = parseAccessConfig(process.env);
  if (accessConfig.allowedOrigins.length === 0) {
    throw new Error("ALLOWED_ORIGINS is required");
  }
  if (accessConfig.allowedHosts.length === 0) {
    throw new Error("ALLOWED_HOSTS is required");
  }
} catch (error) {
  console.error(`invalid relay configuration: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

const relay = startLocalRelay({
  port,
  host: process.env.HOST ?? "0.0.0.0",
  accessConfig,
  maxSessions: positiveInteger("MAX_SESSIONS", 256),
  targetConnectTimeoutMs: positiveInteger("TARGET_CONNECT_TIMEOUT_MS", 10_000),
});
let shuttingDown = false;

relay.once("listening", () => {
  console.log(`relay listening on ${process.env.HOST ?? "0.0.0.0"}:${port}`);
});
relay.once("error", (error) => {
  console.error(`relay failed: ${error.message}`);
  process.exitCode = 1;
});

function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;

  void closeLocalRelay(relay).catch((error: unknown) => {
    console.error(`failed to close relay: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
