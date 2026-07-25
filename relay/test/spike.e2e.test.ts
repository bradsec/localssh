import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createInterface, type Interface } from "node:readline";
import { describe, expect, it } from "vitest";
import type { WebSocketServer } from "ws";

const engineDir = path.resolve(__dirname, "../../engine");

interface SSHHandle {
  close(): unknown;
  write(data: Uint8Array): unknown;
}

async function readAddress(
  sshd: ChildProcessWithoutNullStreams,
  rl: Interface,
  stderr: string[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    const onLine = (line: string) => {
      cleanup();
      resolve(line);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(
        new Error(
          `testsshd exited before reporting its address (code=${code}, signal=${signal}): ${stderr.join("")}`,
        ),
      );
    };
    const cleanup = () => {
      rl.off("line", onLine);
      sshd.off("error", onError);
      sshd.off("exit", onExit);
    };

    rl.once("line", onLine);
    sshd.once("error", onError);
    sshd.once("exit", onExit);
  });
}

async function stopChild(sshd: ChildProcessWithoutNullStreams): Promise<void> {
  if (sshd.exitCode !== null || sshd.signalCode !== null) {
    return;
  }

  const exited = new Promise<void>((resolve) => sshd.once("exit", () => resolve()));
  sshd.stdin.end();
  sshd.kill();
  await exited;
}

async function closeRelay(wss: WebSocketServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    wss.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

describe("end-to-end spike: WASM SSH engine through the local relay", () => {
  it("connects, authenticates, verifies the host key, and echoes PTY bytes", async () => {
    execFileSync(path.join(engineDir, "build.sh"), { cwd: engineDir });

    const { startLocalRelay } = await import("../src/local-relay.js");
    const sshd = spawn(path.join(engineDir, "dist/testsshd"), ["tester", "s3cret"]);
    const stderr: string[] = [];
    sshd.stderr.on("data", (chunk: Buffer) => stderr.push(chunk.toString()));
    const rl = createInterface({ input: sshd.stdout });

    let handle: SSHHandle | undefined;
    let wss: WebSocketServer | undefined;

    try {
      const sshdAddr = await readAddress(sshd, rl, stderr);
      const [sshdHost, sshdPort] = sshdAddr.split(":");

      wss = startLocalRelay({ port: 0 });
      await new Promise<void>((resolve) => wss?.once("listening", resolve));
      const relayPort = (wss.address() as { port: number }).port;

      await import(path.join(engineDir, "dist/wasm_exec.js"));
      const go = new (globalThis as any).Go();
      const wasmBytes = readFileSync(path.join(engineDir, "dist/engine.wasm"));
      const module = await WebAssembly.compile(wasmBytes);
      const instance = await WebAssembly.instantiate(module, go.importObject);
      void go.run(instance);

      const received: Buffer[] = [];
      let fingerprint = "";
      const connectedHandle: SSHHandle = await (globalThis as any).sshConnect(
        `ws://127.0.0.1:${relayPort}`,
        sshdHost,
        sshdPort,
        "tester",
        "s3cret",
        {
          onHostKey: (fp: string) => {
            fingerprint = fp;
            return true;
          },
          onData: (chunk: Uint8Array) => received.push(Buffer.from(chunk)),
          onClose: () => {},
        },
      );
      handle = connectedHandle;

      expect(fingerprint).toMatch(/^SHA256:/);

      connectedHandle.write(new TextEncoder().encode("hello\n"));
      await expect
        .poll(() => Buffer.concat(received).toString(), { interval: 10, timeout: 2_000 })
        .toBe("hello\n");
    } finally {
      try {
        handle?.close();
      } finally {
        try {
          if (wss) {
            await closeRelay(wss);
          }
        } finally {
          rl.close();
          await stopChild(sshd);
        }
      }
    }
  }, 15_000);
});
