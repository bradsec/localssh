import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it } from "vitest";
import { WebSocket } from "ws";
import { parseAccessConfig } from "./access.js";
import { handleCapabilities, type CapabilityPolicy } from "./capabilities.js";
import { closeLocalRelay, startLocalRelay } from "./local-relay.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

async function serve(policy: CapabilityPolicy): Promise<string> {
  const server = createServer((request, response) => {
    if (!handleCapabilities(request, response, policy)) {
      response.writeHead(418);
      response.end();
    }
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const allowlist = parseAccessConfig({ ALLOWED_ORIGINS: "https://ssh.example", ALLOWED_HOSTS: "*" });

it.each([
  [0, { protocols: [1, 2], resume: false, maxGraceMs: 0 }],
  [3_600_000, { protocols: [1, 2], resume: true, maxGraceMs: 3_600_000 }],
  [null, { protocols: [1, 2], resume: true, maxGraceMs: null }],
])("reports cap %s as JSON that is never cached", async (maxGraceMs, body) => {
  const base = await serve({ maxGraceMs, accessConfig: allowlist, sameOrigin: false });
  const response = await fetch(`${base}/capabilities`);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/json");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual(body);
});

it("matches a prefixed path and ignores the query, and leaves other paths alone", async () => {
  const base = await serve({ maxGraceMs: 0, sameOrigin: false });
  expect((await fetch(`${base}/relay/capabilities?x=1`)).status).toBe(200);
  expect((await fetch(`${base}/capabilities/extra`)).status).toBe(418);
  expect((await fetch(`${base}/mycapabilities`)).status).toBe(418);
  expect((await fetch(`${base}/`)).status).toBe(418);
});

it("echoes an allowlisted origin and omits CORS for an unknown one", async () => {
  const base = await serve({ maxGraceMs: 0, accessConfig: allowlist, sameOrigin: false });
  const allowed = await fetch(`${base}/capabilities`, {
    headers: { Origin: "https://ssh.example" },
  });
  expect(allowed.headers.get("access-control-allow-origin")).toBe("https://ssh.example");
  expect(allowed.headers.get("vary")).toBe("Origin");
  const foreign = await fetch(`${base}/capabilities`, {
    headers: { Origin: "https://evil.example" },
  });
  expect(foreign.status).toBe(200);
  expect(foreign.headers.get("access-control-allow-origin")).toBeNull();
  const none = await fetch(`${base}/capabilities`);
  expect(none.headers.get("access-control-allow-origin")).toBeNull();
});

it("echoes any origin under the wildcard and for the loopback relay without access config", async () => {
  const wildcard = parseAccessConfig({ ALLOWED_ORIGINS: "*", ALLOWED_HOSTS: "*" });
  for (const policy of [
    { maxGraceMs: 0, accessConfig: wildcard, sameOrigin: false },
    { maxGraceMs: 0, sameOrigin: false },
  ]) {
    const base = await serve(policy);
    const response = await fetch(`${base}/capabilities`, {
      headers: { Origin: "https://any.example" },
    });
    expect(response.headers.get("access-control-allow-origin")).toBe("https://any.example");
  }
});

it("adds no CORS header in same-origin mode", async () => {
  const wildcard = parseAccessConfig({ ALLOWED_ORIGINS: "*", ALLOWED_HOSTS: "*" });
  const base = await serve({ maxGraceMs: 0, accessConfig: wildcard, sameOrigin: true });
  const response = await fetch(`${base}/capabilities`, {
    headers: { Origin: "https://any.example" },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
});

it.each(["POST", "PUT", "OPTIONS", "HEAD"])("answers %s with 405", async (method) => {
  const base = await serve({ maxGraceMs: 0, sameOrigin: false });
  const response = await fetch(`${base}/relay/capabilities`, { method });
  expect(response.status).toBe(405);
  expect(response.headers.get("allow")).toBe("GET");
});

it("answers capabilities on a standalone relay, still upgrades, and frees the port on close", async () => {
  const relay = startLocalRelay({ port: 0, maxGraceMs: 3_600_000 });
  await new Promise<void>((resolve) => relay.once("listening", resolve));
  const port = (relay.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  let closed = false;
  try {
    for (const path of ["/capabilities", "/relay/capabilities"]) {
      const response = await fetch(`${base}${path}`, {
        headers: { Origin: "http://localhost:5173" },
      });
      expect(await response.json()).toEqual({
        protocols: [1, 2],
        resume: true,
        maxGraceMs: 3_600_000,
      });
      expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    }
    expect((await fetch(`${base}/`)).status).toBe(426);
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    ws.close();
    await new Promise<void>((resolve) => ws.once("close", resolve));
    await closeLocalRelay(relay);
    closed = true;
    const reuse = createServer();
    servers.push(reuse);
    await new Promise<void>((resolve, reject) => {
      reuse.once("error", reject);
      reuse.listen(port, "127.0.0.1", resolve);
    });
  } finally {
    if (!closed) await closeLocalRelay(relay);
  }
});

it("frees the standalone port when a client is still attached at shutdown", async () => {
  const relay = startLocalRelay({ port: 0 });
  await new Promise<void>((resolve) => relay.once("listening", resolve));
  const port = (relay.address() as AddressInfo).port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  await closeLocalRelay(relay);
  const reuse = createServer();
  servers.push(reuse);
  await new Promise<void>((resolve, reject) => {
    reuse.once("error", reject);
    reuse.listen(port, "127.0.0.1", resolve);
  });
});

it("reports a listen failure on the standalone relay as an error event", async () => {
  const holder = createServer();
  servers.push(holder);
  await new Promise<void>((resolve) => holder.listen(0, "127.0.0.1", resolve));
  const relay = startLocalRelay({ port: (holder.address() as AddressInfo).port });
  const error = await new Promise<NodeJS.ErrnoException>((resolve) => relay.once("error", resolve));
  expect(error.code).toBe("EADDRINUSE");
  await closeLocalRelay(relay);
});
