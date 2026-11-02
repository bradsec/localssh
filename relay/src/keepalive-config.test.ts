import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { expect, it } from "vitest";
import { parseKeepaliveMaxGraceMs } from "./keepalive-config.js";

it.each([
  [{}, 3_600_000],
  [{ KEEPALIVE_MAX_SECONDS: "" }, 3_600_000],
  [{ ALLOWED_ORIGINS: "*" }, 0],
  [{ ALLOWED_ORIGINS: "*", KEEPALIVE_MAX_SECONDS: "600" }, 600_000],
  [{ KEEPALIVE_MAX_SECONDS: "unlimited" }, null],
  [{ KEEPALIVE_MAX_SECONDS: "0" }, 0],
  [{ KEEPALIVE_MAX_SECONDS: "2147483" }, 2_147_483_000],
])("parses keep-alive policy %j", (env, expected) => {
  expect(parseKeepaliveMaxGraceMs(env)).toBe(expected);
});

it.each(["run-relay", "run-all-in-one", "run-local-relay"])(
  "%s exits on invalid keep-alive config",
  (script) => {
    const result = spawnSync(process.execPath, ["--import", "tsx", `scripts/${script}.ts`], {
      env: {
        ...process.env,
        ALLOWED_ORIGINS: "http://localhost:9080",
        ALLOWED_HOSTS: "*",
        KEEPALIVE_MAX_SECONDS: "abc",
      },
      encoding: "utf8",
      timeout: 5000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("invalid KEEPALIVE_MAX_SECONDS");
  },
);

it.each(["2147484", "-1", "1.5", "abc"])('rejects invalid cap "%s"', (value) => {
  expect(() => parseKeepaliveMaxGraceMs({ KEEPALIVE_MAX_SECONDS: value })).toThrow(
    "invalid KEEPALIVE_MAX_SECONDS",
  );
});

it.each([
  ["600", 600_000],
  ["0", 0],
])("local relay reports configured cap %s", async (value, expected) => {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("no test port");
  await new Promise<void>((resolve) => probe.close(() => resolve()));

  const relay = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/run-local-relay.ts", String(address.port)],
    {
      env: { ...process.env, KEEPALIVE_MAX_SECONDS: value },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  relay.stderr.on("data", (data: Buffer) => (stderr += data.toString()));
  try {
    await new Promise<void>((resolve, reject) => {
      relay.stdout.on("data", (data: Buffer) => {
        if (data.toString().includes("local relay listening")) resolve();
      });
      relay.once("exit", (code) => reject(new Error(`relay exited: ${code}: ${stderr}`)));
    });
    const response = await fetch(`http://127.0.0.1:${address.port}/capabilities`);
    expect(await response.json()).toMatchObject({ resume: expected !== 0, maxGraceMs: expected });
  } finally {
    if (relay.exitCode === null) {
      relay.kill("SIGKILL");
      await new Promise<void>((resolve) => relay.once("exit", resolve));
    }
  }
});
