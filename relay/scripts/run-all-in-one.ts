import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { resolve } from "node:path";
import { parseAccessConfig } from "../src/access.js";
import { parseKeepaliveMaxGraceMs } from "../src/keepalive-config.js";
import { closeLocalRelay, startLocalRelay } from "../src/local-relay.js";
import { createWebHandler } from "../src/web-server.js";

const port = Number(process.env.PORT ?? 80);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT must be 1..65535");
const cert = process.env.TLS_CERT_FILE;
const key = process.env.TLS_KEY_FILE;
if (Boolean(cert) !== Boolean(key))
  throw new Error("TLS_CERT_FILE and TLS_KEY_FILE must both be set");

const accessConfig = parseAccessConfig({
  ...process.env,
  ALLOWED_HOSTS: process.env.ALLOWED_HOSTS ?? "*",
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ?? "*",
});
const sameOrigin = !process.env.ALLOWED_ORIGINS;
const maxGraceMs = parseKeepaliveMaxGraceMs(process.env);
const handler = createWebHandler(resolve(process.env.STATIC_ROOT ?? "/app/frontend"), {
  capabilities: { maxGraceMs, accessConfig, sameOrigin },
});
const server =
  cert && key
    ? createHttpsServer({ cert: readFileSync(cert), key: readFileSync(key) }, handler)
    : createHttpServer(handler);
const relay = startLocalRelay({
  port,
  server,
  path: "/relay",
  sameOrigin,
  publicHosts: process.env.PUBLIC_HOSTS?.split(",") ?? [],
  accessConfig,
  maxSessions: Number(process.env.MAX_SESSIONS ?? 256),
  targetConnectTimeoutMs: Number(process.env.TARGET_CONNECT_TIMEOUT_MS ?? 10_000),
  maxGraceMs,
});
server.listen(port, process.env.HOST ?? "0.0.0.0");
server.once("error", (error) => {
  console.error(`server failed: ${error.message}`);
  process.exitCode = 1;
});
let stopping = false;
function shutdown(): void {
  if (stopping) return;
  stopping = true;
  void closeLocalRelay(relay).then(
    () => server.close(),
    (error: unknown) => {
      console.error(`shutdown failed: ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
      server.close();
    },
  );
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
