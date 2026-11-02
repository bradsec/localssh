import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createWebHandler } from "./web-server.js";
import { closeLocalRelay, startLocalRelay } from "./local-relay.js";
import { parseAccessConfig } from "./access.js";

const root = await mkdtemp(join(tmpdir(), "localssh-web-"));
await writeFile(join(root, "index.html"), "<title>localssh</title>");
await writeFile(join(root, "engine.wasm"), "wasm");
await writeFile(join(root, "app.js"), "js");

it("serves the page and WASM with security headers, and keeps /relay for WebSocket", async () => {
  const server = createServer(createWebHandler(root));
  const relay = startLocalRelay({
    port: 0,
    server,
    path: "/relay",
    sameOrigin: true,
    accessConfig: parseAccessConfig({ ALLOWED_HOSTS: "*", ALLOWED_ORIGINS: "*" }),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing server address");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const page = await fetch(base);
    expect(await page.text()).toContain("localssh");
    expect(page.headers.get("content-security-policy")).toContain("'wasm-unsafe-eval'");
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    expect((await fetch(`${base}/engine.wasm`)).headers.get("content-type")).toBe(
      "application/wasm",
    );
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await fetch(`${base}/missing/route`)).status).toBe(200);
    expect((await fetch(`${base}/../package.json`)).headers.get("content-type")).not.toBe(
      "application/json",
    );
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/relay`, { origin: base });
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    ws.close();
    await new Promise<void>((resolve) => ws.once("close", resolve));
    const foreign = new WebSocket(`ws://127.0.0.1:${address.port}/relay`, {
      origin: "https://evil.example",
    });
    foreign.on("error", () => {});
    const status = await new Promise<number>((resolve) =>
      foreign.once("unexpected-response", (_request, response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      }),
    );
    expect(status).toBe(403);
  } finally {
    await closeLocalRelay(relay);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("answers capabilities before static files and the /relay 404", async () => {
  const server = createServer(
    createWebHandler(root, {
      capabilities: {
        maxGraceMs: 120_000,
        accessConfig: parseAccessConfig({ ALLOWED_HOSTS: "*", ALLOWED_ORIGINS: "*" }),
        sameOrigin: true,
      },
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing server address");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(`${base}/relay/capabilities`, {
      headers: { Origin: base },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ protocols: [1, 2], resume: true, maxGraceMs: 120_000 });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect((await fetch(`${base}/capabilities`)).status).toBe(200);
    expect((await fetch(`${base}/relay/capabilities`, { method: "POST" })).status).toBe(405);
    expect((await fetch(`${base}/relay/other`)).status).toBe(404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("leaves /relay/capabilities as a 404 when no capability policy is given", async () => {
  const server = createServer(createWebHandler(root));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing server address");
  try {
    expect((await fetch(`http://127.0.0.1:${address.port}/relay/capabilities`)).status).toBe(404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});
