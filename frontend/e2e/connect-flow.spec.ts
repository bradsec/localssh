import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createHash } from "node:crypto";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

test("pagehide resumes the same terminal session and reload starts fresh", async ({ page }) => {
  const address = process.env.E2E_SSHD_ADDR!;
  const host = address.slice(0, address.lastIndexOf(":"));
  const port = address.slice(address.lastIndexOf(":") + 1);
  await page.addInitScript(() => {
    const Original = window.WebSocket;
    const sockets: WebSocket[] = [];
    const received: unknown[][] = [];
    Object.assign(window, { testSockets: sockets, testReceived: received });
    window.WebSocket = class extends Original {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        sockets.push(this);
        this.addEventListener("message", (event) => {
          if (typeof event.data === "string") received.push(JSON.parse(event.data));
        });
      }
    };
  });
  await page.goto("/");
  await page.getByLabel(/^Host$/i).fill(host);
  await page.getByLabel(/^Port$/i).fill(port);
  await page.getByLabel(/^Username$/i).fill("tester");
  await page.getByLabel(/^Password$/i).fill("s3cret");
  await page.getByRole("button", { name: /^Connect to server$/i }).click();
  await page.getByRole("button", { name: /trust and connect/i }).click();
  const terminal = page.getByRole("tabpanel", { name: `${host} terminal` });
  await expect(page.getByRole("tab", { name: `${host}, connected` })).toBeVisible();
  await terminal.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("before-background");
  await page.keyboard.press("Enter");
  await expect(terminal.locator(".xterm-rows")).toContainText("before-background");
  const readyBefore = await page.evaluate(
    () =>
      (window as unknown as { testReceived: unknown[][] }).testReceived.filter(
        (frame) => frame[1] === "ready",
      ).length,
  );

  await page.evaluate(() => {
    window.dispatchEvent(new Event("pagehide"));
    const sockets = (window as unknown as { testSockets: WebSocket[] }).testSockets;
    sockets.at(-1)?.close();
    window.dispatchEvent(new Event("pageshow"));
  });
  await page.waitForFunction(() =>
    (window as unknown as { testReceived: unknown[][] }).testReceived.some(
      (frame) => frame[1] === "resumed",
    ),
  );
  await expect(page.getByRole("tab", { name: `${host}, connected` })).toBeVisible();
  await terminal.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("after-background");
  await page.keyboard.press("Enter");
  await expect(terminal.locator(".xterm-rows")).toContainText("after-background");
  expect(
    await page.evaluate(() => {
      const frames = (window as unknown as { testReceived: unknown[][] }).testReceived;
      return frames.filter((frame) => frame[1] === "ready").length;
    }),
  ).toBe(readyBefore);

  await page.reload();
  await expect(page.getByRole("button", { name: /^Connect to server$/i })).toBeVisible();
});

test.describe("one-tap Reconnect on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("Reconnect after an expired session with a typed password shows the prefilled form", async ({
    page,
  }) => {
    const address = process.env.E2E_SSHD_ADDR!;
    const host = address.slice(0, address.lastIndexOf(":"));
    const port = address.slice(address.lastIndexOf(":") + 1);
    // A relay capped at 1 s grants 1 s of keep-alive, so the session expires for
    // real while the page is away. Page sockets are pointed at it.
    const relayPort = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const bound = server.address();
        server.close(() => resolve(typeof bound === "object" && bound ? bound.port : 0));
      });
    });
    const relay = spawn("npm", ["run", "relay:local", "--", String(relayPort)], {
      cwd: path.resolve("../relay"),
      env: { ...process.env, KEEPALIVE_MAX_SECONDS: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      // Its own process group, so the relay npm starts is stopped with it.
      detached: true,
    });
    await new Promise<void>((resolve, reject) => {
      relay.stdout.on("data", (data: Buffer) => {
        if (data.toString().includes(`local relay listening on ${relayPort}`)) resolve();
      });
      relay.once("exit", (code) => reject(new Error(`short-grace relay exited: ${code}`)));
    });
    try {
      await page.addInitScript((target) => {
        const Original = window.WebSocket;
        const sockets: WebSocket[] = [];
        Object.assign(window, { testSockets: sockets });
        window.WebSocket = class extends Original {
          constructor(url: string | URL, protocols?: string | string[]) {
            super(String(url).replace(/127\.0\.0\.1:\d+/, target), protocols);
            sockets.push(this);
          }
        };
      }, `127.0.0.1:${relayPort}`);
      await page.goto("/");
      await page.getByLabel(/^Host$/i).fill(host);
      await page.getByLabel(/^Port$/i).fill(port);
      await page.getByLabel(/^Username$/i).fill("tester");
      await page.getByLabel(/^Password$/i).fill("s3cret");
      await page.getByRole("button", { name: /^Connect to server$/i }).tap();
      await page.getByRole("button", { name: /trust and connect/i }).tap();
      await expect(page.getByRole("toolbar", { name: "Terminal keys" })).toBeVisible();
      await page.locator(".xterm-screen").tap();
      await page.keyboard.type("before-expiry");
      await expect(page.locator(".xterm-rows")).toContainText("before-expiry", { timeout: 5_000 });

      await page.evaluate(async () => {
        window.dispatchEvent(new Event("pagehide"));
        (window as unknown as { testSockets: WebSocket[] }).testSockets.at(-1)?.close();
        await new Promise((resolve) => setTimeout(resolve, 2_500));
        window.dispatchEvent(new Event("pageshow"));
      });
      await expect(page.getByText("Session expired.").first()).toBeVisible();
      await page.getByRole("button", { name: "Reconnect" }).tap();

      await expect(page.getByLabel(/^Host$/i)).toHaveValue(host);
      await expect(page.getByLabel(/^Port$/i)).toHaveValue(port);
      await expect(page.getByLabel(/^Username$/i)).toHaveValue("tester");
      await expect(page.getByLabel(/^Password$/i)).toHaveValue("");
      await expect(page.getByLabel(/^Password$/i)).toBeFocused();

      await page.getByLabel(/^Password$/i).fill("s3cret");
      await page.getByRole("button", { name: /^Connect to server$/i }).tap();
      await expect(page.getByRole("toolbar", { name: "Terminal keys" })).toBeVisible();
      const rows = page.locator(".xterm-rows");
      await expect(rows).toContainText("before-expiry");
      await expect(rows).toContainText("[localssh] New connection.");
      await page.getByRole("button", { name: "Open terminals" }).tap();
      await expect(page.getByRole("tab")).toHaveCount(1);
    } finally {
      // SIGKILL: the relay's SIGTERM shutdown waits for live sessions to end.
      process.kill(-relay.pid!, "SIGKILL");
    }
  });
});

test("resumes one WASM SSH session with each echoed byte exactly once", async ({ page }) => {
  test.setTimeout(90_000);
  const address = process.env.E2E_SSHD_ADDR!;
  const separator = address.lastIndexOf(":");
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
  const relay = spawn("npm", ["run", "relay:local", "--", String(port)], {
    cwd: path.resolve("../relay"),
    env: { ...process.env, KEEPALIVE_MAX_SECONDS: "3600" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      relay.stdout.on("data", (data: Buffer) => {
        if (data.toString().includes(`local relay listening on ${port}`)) resolve();
      });
      relay.once("exit", (code) => reject(new Error(`v2 relay exited: ${code}`)));
    });
    await page.addInitScript(() => {
      const Original = window.WebSocket;
      const sockets: WebSocket[] = [];
      const sent: unknown[] = [];
      const sendTimes: number[] = [];
      const received: unknown[] = [];
      (window as unknown as { testSockets: WebSocket[] }).testSockets = sockets;
      Object.assign(window, { testSent: sent, testReceived: received, testSendTimes: sendTimes });
      window.WebSocket = class extends Original {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          sockets.push(this);
          this.addEventListener("message", (event) => {
            if (typeof event.data === "string") received.push(JSON.parse(event.data));
          });
        }
        override send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
          if (typeof data === "string") {
            const frame = JSON.parse(data);
            sent.push(frame);
            sendTimes.push(performance.now());
            if (
              frame[1] === "resume" &&
              (window as unknown as { testDropResumes?: boolean }).testDropResumes
            ) {
              this.close();
              return;
            }
          }
          super.send(data);
        }
      };
    });
    await page.goto("/");
    await page.getByLabel(/^Host$/i).fill(address.slice(0, separator));
    await page.getByLabel(/^Port$/i).fill(address.slice(separator + 1));
    await page.getByLabel(/^Username$/i).fill("tester");
    await page.getByLabel(/^Password$/i).fill("s3cret");
    await page.getByRole("button", { name: /^Connect to server$/i }).click();
    await page.getByRole("button", { name: /trust and connect/i }).click();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    const existingConnects = await page.evaluate(
      () =>
        (window as unknown as { testSent: unknown[][] }).testSent.filter(
          (frame) => frame[1] === "connect",
        ).length,
    );

    await page.evaluate(
      async ({ host, port, relayPort }) => {
        const output: string[][] = [[], []];
        const closes: string[] = [];
        const statuses: string[][] = [[], []];
        const grants: Array<
          { grantedGraceMs: number | null; capGraceMs: number | null } | undefined
        > = [];
        const handles = [];
        for (let index = 0; index < 2; index++) {
          handles.push(
            await window.sshConnect(`ws://127.0.0.1:${relayPort}`, host, port, "tester", "s3cret", {
              onHostKey: () => true,
              onData: (chunk) => output[index].push(new TextDecoder().decode(chunk)),
              onClose: (reason) => {
                closes[index] = reason ?? "";
              },
              onTransportStatus: (status, info) => {
                statuses[index].push(status);
                if (status === "connected") grants[index] = info;
              },
              keepAliveMs: index === 0 ? 120_000 : null,
            }),
          );
        }
        Object.assign(window, {
          testSessions: handles,
          testOutput: output,
          testCloses: closes,
          testStatuses: statuses,
          testGrants: grants,
        });
      },
      { host: address.slice(0, separator), port: address.slice(separator + 1), relayPort: port },
    );
    expect(
      await page.evaluate(() => (window as unknown as { testGrants: unknown[] }).testGrants),
    ).toEqual([
      { grantedGraceMs: 120_000, capGraceMs: 3_600_000 },
      { grantedGraceMs: 3_600_000, capGraceMs: 3_600_000 },
    ]);
    expect(
      await page.evaluate(
        (count) =>
          (window as unknown as { testSent: unknown[][] }).testSent
            .filter((frame) => frame[1] === "connect")
            .slice(count)
            .map((frame) => frame[4]),
        existingConnects,
      ),
    ).toEqual([120_000, null]);
    const marker = `resume-${crypto.randomUUID()}`;
    const otherMarker = `other-${crypto.randomUUID()}`;
    await page.evaluate(
      ({ text, relayPort }) => {
        const state = window as unknown as {
          testSessions: Array<{ write(data: Uint8Array): string | null }>;
          testSockets: WebSocket[];
        };
        state.testSessions[0].write(new TextEncoder().encode(text));
        state.testSockets.filter((socket) => socket.url.includes(`:${relayPort}`))[0].close();
      },
      { text: marker, relayPort: port },
    );
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { testStatuses: string[][] }).testStatuses[0]),
      )
      .toContain("reconnecting");
    await page.evaluate(() => {
      const state = window as unknown as {
        testSessions: Array<{ write(data: Uint8Array): string | null }>;
      };
      state.testSessions[0].write(new TextEncoder().encode("-detached"));
    });
    await page.evaluate((text) => {
      const state = window as unknown as {
        testSessions: Array<{ write(data: Uint8Array): string | null }>;
      };
      state.testSessions[1].write(new TextEncoder().encode(text));
    }, otherMarker);
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as { testOutput: string[][] }).testOutput[0].join(""),
        ),
      )
      .toContain(`${marker}-detached`);
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as { testOutput: string[][] }).testOutput[1].join(""),
        ),
      )
      .toContain(otherMarker);
    const output = await page.evaluate(() =>
      (window as unknown as { testOutput: string[][] }).testOutput[0].join(""),
    );
    expect(output.split(marker).length - 1).toBe(1);
    expect(output).not.toContain(otherMarker);
    const otherOutput = await page.evaluate(() =>
      (window as unknown as { testOutput: string[][] }).testOutput[1].join(""),
    );
    expect(otherOutput).not.toContain(marker);
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            (window as unknown as { testSent: unknown[][] }).testSent.some(
              (frame) => frame[1] === "ping",
            ),
          ),
        { timeout: 25_000 },
      )
      .toBe(true);
    const burstError = await page.evaluate(() => {
      const state = window as unknown as {
        testSessions: Array<{ write(data: Uint8Array): string | null }>;
      };
      return state.testSessions[1].write(new Uint8Array(1_048_576).fill(120));
    });
    expect(burstError).toBeNull();
    await expect
      .poll(
        () =>
          page.evaluate(
            () => (window as unknown as { testOutput: string[][] }).testOutput[1].join("").length,
          ),
        { timeout: 15_000 },
      )
      .toBeGreaterThan(1_048_576);
    const frameCounts = await page.evaluate(() => {
      const state = window as unknown as { testReceived: unknown[][]; testSent: unknown[][] };
      return {
        data: state.testReceived.filter((frame) => frame[1] === "data").length,
        ack: state.testSent.filter((frame) => frame[1] === "ack" && frame[2] === "server").length,
      };
    });
    expect(frameCounts.ack).toBeLessThan(frameCounts.data / 2);
    await page.evaluate(() => {
      const state = window as unknown as { testSessions: Array<{ detach?(): void }> };
      state.testSessions[0].detach?.();
    });
    await expect
      .poll(() =>
        page.evaluate((relayPort) => {
          const state = window as unknown as { testSockets: WebSocket[] };
          return state.testSockets.filter((socket) => socket.url.includes(`:${relayPort}`)).at(-1)
            ?.readyState;
        }, port),
      )
      .toBe(3);
    await page.evaluate(() => {
      const state = window as unknown as {
        testSessions: Array<{ resume?(): void; write(data: Uint8Array): string | null }>;
      };
      state.testSessions[0].write(new TextEncoder().encode("manual-detach"));
      state.testSessions[0].resume?.();
    });
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as { testOutput: string[][] }).testOutput[0].join(""),
        ),
      )
      .toContain("manual-detach");
    await page.evaluate(() => {
      const state = window as unknown as { testSessions: Array<{ close(): void }> };
      state.testSessions[0].close();
    });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const state = window as unknown as { testSent: unknown[][] };
          return state.testSent.some((frame) => frame[1] === "close");
        }),
      )
      .toBe(true);
    const resumeAfterClose = await page.evaluate(async (relayPort) => {
      const state = window as unknown as { testReceived: unknown[][] };
      const ready = state.testReceived.find((frame) => frame[1] === "ready")!;
      const resumed = state.testReceived.filter((frame) => frame[1] === "resumed").at(-1)!;
      return await new Promise<string>((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${relayPort}`);
        socket.addEventListener("open", () =>
          socket.send(JSON.stringify([2, "resume", ready[2], resumed[4], 0, 0])),
        );
        socket.addEventListener("message", (event) => {
          const frame = JSON.parse(event.data as string) as unknown[];
          if (frame[1] === "error") resolve(String(frame[2]));
        });
        socket.addEventListener("error", reject);
      });
    }, port);
    expect(resumeAfterClose).toBe("expired");
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { testCloses: string[] }).testCloses[0]),
      )
      .toBe("");
    await page.evaluate(() => {
      const state = window as unknown as {
        testSessions: Array<{ write(data: Uint8Array): string | null }>;
      };
      state.testSessions[1].write(new TextEncoder().encode("still-open"));
    });
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as { testOutput: string[][] }).testOutput[1].join(""),
        ),
      )
      .toContain("still-open");
    await page.evaluate((relayPort) => {
      const state = window as unknown as { testSockets: WebSocket[] };
      state.testSockets
        .filter((socket) => socket.url.includes(`:${relayPort}`))[1]
        .dispatchEvent(
          new MessageEvent("message", { data: JSON.stringify([2, "error", "offset_mismatch"]) }),
        );
    }, port);
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as { testStatuses: string[][] }).testStatuses[1].at(-1),
        ),
      )
      .toBe("expired");
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { testCloses: string[] }).testCloses[1]),
      )
      .toContain("offset_mismatch");
    const takeover = await page.evaluate(
      async ({ relayPort, host, sshPort }) => {
        const url = `ws://127.0.0.1:${relayPort}`;
        const first = new WebSocket(url);
        const ready = await new Promise<unknown[]>((resolve) => {
          first.addEventListener("open", () =>
            first.send(JSON.stringify([2, "connect", host, Number(sshPort), 120_000])),
          );
          first.addEventListener(
            "message",
            (event) => resolve(JSON.parse(event.data as string) as unknown[]),
            { once: true },
          );
        });
        const superseded = new Promise<unknown[]>((resolve) => {
          first.addEventListener("message", (event) => {
            const frame = JSON.parse(event.data as string) as unknown[];
            if (frame[1] === "error") resolve(frame);
          });
        });
        const second = new WebSocket(url);
        const resumed = await new Promise<unknown[]>((resolve) => {
          second.addEventListener("open", () =>
            second.send(JSON.stringify([2, "resume", ready[2], ready[3], 0, 0])),
          );
          second.addEventListener(
            "message",
            (event) => resolve(JSON.parse(event.data as string) as unknown[]),
            { once: true },
          );
        });
        const oldResult = await superseded;
        second.send(JSON.stringify([2, "close"]));
        return { oldResult, resumed, oldToken: ready[3] };
      },
      { relayPort: port, host: address.slice(0, separator), sshPort: address.slice(separator + 1) },
    );
    expect(takeover.oldResult).toEqual([2, "error", "superseded"]);
    expect(takeover.resumed.slice(0, 4)).toEqual([2, "resumed", 0, 0]);
    expect(takeover.resumed[4]).not.toBe(takeover.oldToken);
    const detachedClose = await page.evaluate(
      async ({ relayPort, host, sshPort }) => {
        let closed = false;
        const handle = await window.sshConnect(
          `ws://127.0.0.1:${relayPort}`,
          host,
          sshPort,
          "tester",
          "s3cret",
          {
            onHostKey: () => true,
            onData: () => {},
            onClose: () => {
              closed = true;
            },
            keepAliveMs: 120_000,
          },
        );
        const state = window as unknown as {
          testReceived: unknown[][];
          testSent: unknown[][];
          testSockets: WebSocket[];
        };
        const ready = state.testReceived.filter((frame) => frame[1] === "ready").at(-1)!;
        const serverAck = state.testSent
          .filter((frame) => frame[1] === "ack" && frame[2] === "server")
          .at(-1)![3];
        handle.detach?.();
        await new Promise<void>((resolve) =>
          state.testSockets.at(-1)!.addEventListener("close", () => resolve(), { once: true }),
        );
        handle.close();
        await new Promise<void>((resolve) => {
          const check = () => (closed ? resolve() : setTimeout(check, 10));
          check();
        });
        return await new Promise<string>((resolve, reject) => {
          const socket = new WebSocket(`ws://127.0.0.1:${relayPort}`);
          socket.addEventListener("open", () =>
            socket.send(JSON.stringify([2, "resume", ready[2], ready[3], 0, serverAck])),
          );
          socket.addEventListener("message", (event) => {
            const frame = JSON.parse(event.data as string) as unknown[];
            if (frame[1] === "error") resolve(String(frame[2]));
            if (frame[1] === "resumed")
              reject(new Error("detached session remained resumable after close"));
          });
        });
      },
      { relayPort: port, host: address.slice(0, separator), sshPort: address.slice(separator + 1) },
    );
    expect(detachedClose).toBe("expired");
    const takeoverStatus = await page.evaluate(
      async ({ relayPort, host, sshPort }) => {
        const statuses: string[] = [];
        const closes: string[] = [];
        const handle = await window.sshConnect(
          `ws://127.0.0.1:${relayPort}`,
          host,
          sshPort,
          "tester",
          "s3cret",
          {
            onHostKey: () => true,
            onData: () => {},
            onClose: (reason) => closes.push(reason ?? ""),
            onTransportStatus: (status) => statuses.push(status),
            keepAliveMs: 120_000,
          },
        );
        const state = window as unknown as {
          testReceived: unknown[][];
          testSent: unknown[][];
          testSockets: WebSocket[];
        };
        const ready = state.testReceived.filter((frame) => frame[1] === "ready").at(-1)!;
        await new Promise((resolve) => setTimeout(resolve, 100));
        const clientAck = state.testReceived
          .filter((frame) => frame[1] === "ack" && frame[2] === "client")
          .at(-1)![3];
        const serverAck = state.testSent
          .filter((frame) => frame[1] === "ack" && frame[2] === "server")
          .at(-1)![3];
        const socket = new WebSocket(`ws://127.0.0.1:${relayPort}`);
        const resumed = await new Promise<unknown[]>((resolve) => {
          socket.addEventListener("open", () =>
            socket.send(JSON.stringify([2, "resume", ready[2], ready[3], clientAck, serverAck])),
          );
          socket.addEventListener(
            "message",
            (event) => resolve(JSON.parse(event.data as string) as unknown[]),
            { once: true },
          );
        });
        await new Promise<void>((resolve) => {
          const check = () => (statuses.includes("expired") ? resolve() : setTimeout(check, 10));
          check();
        });
        const resumeCount = state.testSent.filter((frame) => frame[1] === "resume").length;
        await new Promise((resolve) => setTimeout(resolve, 700));
        const retried =
          state.testSent.filter((frame) => frame[1] === "resume").length !== resumeCount;
        socket.send(JSON.stringify([2, "close"]));
        handle.close();
        return { statuses, closes, resumed, retried };
      },
      { relayPort: port, host: address.slice(0, separator), sshPort: address.slice(separator + 1) },
    );
    expect(takeoverStatus.resumed[1]).toBe("resumed");
    expect(takeoverStatus.statuses).toContain("expired");
    expect(takeoverStatus.closes.join(" ")).toContain("superseded");
    expect(takeoverStatus.retried).toBe(false);

    const priorResumes = await page.evaluate(
      () =>
        (window as unknown as { testSent: unknown[][] }).testSent.filter(
          (frame) => frame[1] === "resume",
        ).length,
    );
    await page.evaluate(
      async ({ relayPort, host, sshPort }) => {
        const handle = await window.sshConnect(
          `ws://127.0.0.1:${relayPort}`,
          host,
          sshPort,
          "tester",
          "s3cret",
          {
            onHostKey: () => true,
            onData: () => {},
            onClose: () => {},
            keepAliveMs: 120_000,
          },
        );
        const state = window as unknown as {
          testDropResumes: boolean;
          testSockets: WebSocket[];
          testRetryHandle: typeof handle;
        };
        state.testDropResumes = true;
        state.testRetryHandle = handle;
        state.testSockets
          .filter((socket) => socket.url.includes(`:${relayPort}`))
          .at(-1)!
          .close();
      },
      { relayPort: port, host: address.slice(0, separator), sshPort: address.slice(separator + 1) },
    );
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const state = window as unknown as { testSent: unknown[][] };
            return state.testSent.filter((frame) => frame[1] === "resume").length;
          }),
        { timeout: 15_000 },
      )
      .toBeGreaterThanOrEqual(priorResumes + 4);
    const retryIntervals = await page.evaluate(() => {
      const state = window as unknown as {
        testSent: unknown[][];
        testSendTimes: number[];
        testDropResumes: boolean;
        testRetryHandle: { resume(): void };
      };
      const times = state.testSendTimes.filter(
        (_, index) => (state.testSent[index] as unknown[])[1] === "resume",
      );
      state.testDropResumes = false;
      state.testRetryHandle.resume();
      return times
        .slice(-4)
        .slice(1)
        .map((time, index) => time - times.at(-4 + index)!);
    });
    expect(retryIntervals[1]).toBeGreaterThan(retryIntervals[0] * 1.5);
    expect(retryIntervals[2]).toBeGreaterThan(retryIntervals[1] * 1.5);

    const lateResume = await page.evaluate(
      async ({ relayPort, host, sshPort }) => {
        const handle = await window.sshConnect(
          `ws://127.0.0.1:${relayPort}`,
          host,
          sshPort,
          "tester",
          "s3cret",
          {
            onHostKey: () => true,
            onData: () => {},
            onClose: () => {},
            keepAliveMs: 100,
          },
        );
        const state = window as unknown as { testSent: unknown[][] };
        handle.detach?.();
        await new Promise((resolve) => setTimeout(resolve, 300));
        const before = state.testSent.filter((frame) => frame[1] === "resume").length;
        handle.resume?.();
        await new Promise((resolve) => setTimeout(resolve, 150));
        return state.testSent.filter((frame) => frame[1] === "resume").length - before;
      },
      { relayPort: port, host: address.slice(0, separator), sshPort: address.slice(separator + 1) },
    );
    expect(lateResume).toBeGreaterThanOrEqual(1);
  } finally {
    process.kill(-relay.pid!, "SIGKILL");
  }
});

test("v2 resumes in-flight 8 MiB SFTP transfers after socket loss", async ({ page }) => {
  test.setTimeout(120_000);
  const address = process.env.E2E_SSHD_ADDR!;
  const separator = address.lastIndexOf(":");
  const root = process.env.E2E_SFTP_ROOT!;
  const source = Buffer.allocUnsafe(8 << 20);
  for (let index = 0; index < source.length; index++) source[index] = index % 251;
  writeFileSync(path.join(root, "resume-download.bin"), source);
  const expectedHash = createHash("sha256").update(source).digest("hex");
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
  const relay = spawn("npm", ["run", "relay:local", "--", String(port)], {
    cwd: path.resolve("../relay"),
    env: { ...process.env, KEEPALIVE_MAX_SECONDS: "3600" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      relay.stdout.on("data", (data: Buffer) => {
        if (data.toString().includes(`local relay listening on ${port}`)) resolve();
      });
      relay.once("exit", (code) => reject(new Error(`v2 relay exited: ${code}`)));
    });
    await page.addInitScript(() => {
      const Original = window.WebSocket;
      const sockets: WebSocket[] = [];
      Object.assign(window, { transferSockets: sockets });
      window.WebSocket = class extends Original {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          sockets.push(this);
        }
      };
    });
    await page.goto("/");
    await page.getByLabel(/^Host$/i).fill(address.slice(0, separator));
    await page.getByLabel(/^Port$/i).fill(address.slice(separator + 1));
    await page.getByLabel(/^Username$/i).fill("tester");
    await page.getByLabel(/^Password$/i).fill("s3cret");
    await page.getByRole("button", { name: /^Connect to server$/i }).click();
    await page.getByRole("button", { name: /trust and connect/i }).click();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();

    const result = await page.evaluate(
      async ({ host, sshPort, relayPort }) => {
        const statuses: string[] = [];
        const closes: string[] = [];
        const sockets = (window as unknown as { transferSockets: WebSocket[] }).transferSockets;
        const handle = await window.sshConnect(
          `ws://127.0.0.1:${relayPort}`,
          host,
          sshPort,
          "tester",
          "s3cret",
          {
            onHostKey: () => true,
            onData: () => {},
            onClose: (reason) => closes.push(reason ?? ""),
            onTransportStatus: (status) => statuses.push(status),
            keepAliveMs: 120_000,
          },
        );
        const files = await handle.openFiles!();
        const downloadProgress: number[] = [];
        const chunks: Uint8Array[] = [];
        let downloadDropped = false;
        await files.download(
          "/resume-download.bin",
          async (chunk) => {
            chunks.push(chunk.slice());
          },
          (percent) => {
            downloadProgress.push(percent);
            if (!downloadDropped && percent >= 10 && percent < 100) {
              downloadDropped = true;
              sockets.at(-1)!.close();
            }
          },
        );
        const downloaded = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
        let offset = 0;
        for (const chunk of chunks) {
          downloaded.set(chunk, offset);
          offset += chunk.length;
        }
        const downloadHash = Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", downloaded)),
        )
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");

        const uploadBytes = new Uint8Array(8 << 20);
        for (let index = 0; index < uploadBytes.length; index++) uploadBytes[index] = index % 251;
        const uploadProgress: number[] = [];
        let uploadDropped = false;
        await files.upload(
          "/resume-upload.bin",
          new File([uploadBytes], "resume-upload.bin"),
          false,
          (percent) => {
            uploadProgress.push(percent);
            if (!uploadDropped && percent >= 10 && percent < 100) {
              uploadDropped = true;
              sockets.at(-1)!.close();
            }
          },
        );
        const unexpectedCloses = closes.slice();
        files.close();
        handle.close();
        return {
          downloadHash,
          downloadProgress,
          uploadProgress,
          downloadDropped,
          uploadDropped,
          statuses,
          closes: unexpectedCloses,
        };
      },
      { host: address.slice(0, separator), sshPort: address.slice(separator + 1), relayPort: port },
    );
    expect(result.downloadDropped).toBe(true);
    expect(result.uploadDropped).toBe(true);
    expect(result.statuses.filter((status) => status === "reconnecting")).toHaveLength(2);
    expect(result.statuses.filter((status) => status === "connected")).toHaveLength(3);
    expect(result.closes).toEqual([]);
    expect(result.downloadProgress.at(-1)).toBe(100);
    expect(result.uploadProgress.at(-1)).toBe(100);
    expect(
      result.downloadProgress.every(
        (value, index, list) => index === 0 || value >= list[index - 1],
      ),
    ).toBe(true);
    expect(
      result.uploadProgress.every((value, index, list) => index === 0 || value >= list[index - 1]),
    ).toBe(true);
    expect(result.downloadHash).toBe(expectedHash);
    expect(
      createHash("sha256")
        .update(readFileSync(path.join(root, "resume-upload.bin")))
        .digest("hex"),
    ).toBe(expectedHash);
  } finally {
    process.kill(-relay.pid!, "SIGKILL");
    rmSync(path.join(root, "resume-download.bin"), { force: true });
    rmSync(path.join(root, "resume-upload.bin"), { force: true });
  }
});

test("a keepAliveMs-absent connect uses v1 frames", async ({ page }) => {
  const address = process.env.E2E_SSHD_ADDR!;
  await page.addInitScript(() => {
    localStorage.setItem("terminalSettings", JSON.stringify({ keepAlive: "off" }));
    const send = WebSocket.prototype.send;
    const frames: string[] = [];
    Object.assign(window, { testFrames: frames });
    WebSocket.prototype.send = function (data) {
      frames.push(typeof data === "string" ? data : "binary");
      return send.call(this, data);
    };
  });
  await page.goto("/");
  await page.getByLabel(/^Host$/i).fill(address.slice(0, address.lastIndexOf(":")));
  await page.getByLabel(/^Port$/i).fill(address.slice(address.lastIndexOf(":") + 1));
  await page.getByLabel(/^Username$/i).fill("tester");
  await page.getByLabel(/^Password$/i).fill("s3cret");
  await page.getByRole("button", { name: /^Connect to server$/i }).click();
  await page.getByRole("button", { name: /trust and connect/i }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  const frames = await page.evaluate(
    () => (window as unknown as { testFrames: string[] }).testFrames,
  );
  const connects = frames.filter((frame) => frame !== "binary");
  expect(connects.length).toBeGreaterThan(0);
  expect(
    connects.every((frame) => {
      const parsed = JSON.parse(frame) as Record<string, unknown>;
      return (
        parsed.host === address.slice(0, address.lastIndexOf(":")) &&
        parsed.port === Number(address.slice(address.lastIndexOf(":") + 1)) &&
        Object.keys(parsed).length === 2
      );
    }),
  ).toBe(true);
  expect(frames).toContain("binary");
});

for (const viewport of [
  { width: 320, height: 700 },
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  test(`keeps the connect action in view at ${viewport.width}px`, async ({ browser }) => {
    const page = await browser.newPage({ viewport });
    await page.goto("/");
    await expect(page.getByRole("button", { name: /^Connect to server$/i })).toBeInViewport();
    await page.getByRole("heading", { name: "Saved hosts" }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("heading", { name: "Saved hosts" })).toBeInViewport();
    await page.close();
  });

  test(`keeps Help readable at ${viewport.width}px`, async ({ browser }) => {
    const page = await browser.newPage({ viewport });
    await page.goto("/");
    await page.getByRole("button", { name: "Help" }).click();
    const panel = page.locator(".help__panel");
    await expect(panel.getByRole("heading", { name: "Help with localssh" })).toBeVisible();
    const bounds = await panel.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        width: element.clientWidth,
        scroll: element.scrollWidth,
      };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(viewport.width);
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
    await page.close();
  });
}

test("connects through the relay, trusts the host key, and echoes input", async ({ page }) => {
  const sshdAddress = process.env.E2E_SSHD_ADDR;
  expect(sshdAddress, "global setup must provide the SSH server address").toBeTruthy();

  const separator = sshdAddress!.lastIndexOf(":");
  const sshdHost = sshdAddress!.slice(0, separator);
  const sshdPort = sshdAddress!.slice(separator + 1);

  await page.goto("/");
  const terminalInput = page.locator(".xterm-helper-textarea");
  await expect(terminalInput).toHaveAttribute("tabindex", "-1");
  await expect(page.locator(".xterm-accessibility-tree")).toBeAttached();

  await page.getByLabel(/^Host$/i).fill(sshdHost);
  await page.getByLabel(/^Port$/i).fill(sshdPort);
  await page.getByLabel(/^Username$/i).fill("tester");
  await page.getByLabel(/^Password$/i).fill("s3cret");
  await page.getByRole("button", { name: /^Connect to server$/i }).click();

  const hostKeyPrompt = page.getByRole("alertdialog", { name: /verify host key/i });
  await expect(hostKeyPrompt).toBeVisible();
  await expect(hostKeyPrompt).toContainText(/SHA256:/);
  await page.getByRole("button", { name: /trust and connect/i }).click();

  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(hostKeyPrompt).not.toBeVisible();
  await expect(terminalInput).toHaveAttribute("tabindex", "0");
  await expect(terminalInput).toBeFocused();

  await page.locator(".xterm-screen").click();
  await expect(terminalInput).toBeFocused();
  await page.keyboard.type("hello");
  await page.keyboard.press("Enter");

  await expect(page.locator(".xterm-rows")).toContainText("hello", { timeout: 5_000 });
});

test("uploads and downloads a file through the relay", async ({ page }) => {
  const address = process.env.E2E_SSHD_ADDR!;
  await page.goto("/");
  await page.getByLabel(/^Host$/i).fill(address.slice(0, address.lastIndexOf(":")));
  await page.getByLabel(/^Port$/i).fill(address.slice(address.lastIndexOf(":") + 1));
  await page.getByLabel(/^Username$/i).fill("tester");
  await page.getByLabel(/^Password$/i).fill("s3cret");
  await page.getByRole("button", { name: /^Connect to server$/i }).click();
  await page.getByRole("button", { name: /trust and connect/i }).click();
  await page.getByRole("button", { name: "Files" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("region", { name: "Files" })).toBeInViewport();
  await expect(
    page.getByText("No files in this directory. Choose another path or upload a file."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Go to path" }).click();
  await page.getByLabel("Remote path").fill("/missing");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(
    page.getByText("Cannot open /missing: no such file. Check the remote path."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Learn more about files" }).click();
  await expect(page.getByRole("heading", { name: "Browse and transfer files" })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByLabel("Remote path").fill(".");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Current folder" })).toContainText("/");
  await expect(page.getByRole("button", { name: "Up to parent folder" })).toBeDisabled();
  await page.getByLabel("Upload file").setInputFiles({
    name: "sample.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("SFTP round trip"),
  });
  await expect(page.locator(".toast").getByText("Uploaded sample.txt.")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download file sample.txt" }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe("sample.txt");
  await expect(page.getByRole("link", { name: "Save download" })).toBeVisible();
  const stream = await saved.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toBe("SFTP round trip");
  await page.getByLabel("Upload file").setInputFiles({
    name: "sample.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("replacement"),
  });
  await expect(page.getByRole("alertdialog", { name: "Replace file" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("alertdialog", { name: "Replace file" })).not.toBeVisible();
  await page.getByLabel("Upload file").setInputFiles({
    name: "sample.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("replacement"),
  });
  await page.getByRole("button", { name: "Replace file" }).click();
  await expect(page.locator(".toast").getByText("Uploaded sample.txt.")).toBeVisible();
  const replacementDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download file sample.txt" }).click();
  const replaced = await replacementDownload;
  const replacementStream = await replaced.createReadStream();
  const replacementChunks: Buffer[] = [];
  for await (const chunk of replacementStream) replacementChunks.push(Buffer.from(chunk));
  expect(Buffer.concat(replacementChunks).toString()).toBe("replacement");

  const root = process.env.E2E_SFTP_ROOT!;
  mkdirSync(path.join(root, "logs"));
  writeFileSync(path.join(root, "logs", "app.log"), "log line");
  writeFileSync(path.join(root, "large.bin"), "a".repeat(100));
  symlinkSync("logs", path.join(root, "logs-link"));
  symlinkSync("missing", path.join(root, "broken-link"));
  await page.getByRole("button", { name: "Open", exact: true }).click();
  const files = page.getByRole("region", { name: "Files" });
  await expect(files.getByRole("row").filter({ hasText: "logs-link" })).toContainText("logs-link");
  await expect(files.getByRole("row").filter({ hasText: "broken-link" })).toContainText(
    "broken-link",
  );
  await files.getByRole("button", { name: "Size", exact: true }).click();
  const rows = files.locator("tbody tr");
  await expect(rows.first()).toContainText("logs");
  await expect(rows.filter({ hasText: "sample.txt" })).toBeVisible();
  await files.getByText("logs-link/").dblclick();
  await expect(files.getByRole("navigation", { name: "Current folder" })).toContainText(
    "logs-link",
  );
  await expect(page.getByRole("button", { name: "Download file app.log" })).toBeVisible();
  await files
    .getByRole("navigation", { name: "Current folder" })
    .getByRole("button", { name: "/", exact: true })
    .click();
  await expect(files.getByRole("navigation", { name: "Current folder" })).not.toContainText(
    "logs-link",
  );
  await expect(page.getByRole("button", { name: "Download file sample.txt" })).toBeVisible();
  expect(readdirSync(root).filter((name) => name.startsWith(".localssh-upload-"))).toEqual([]);
  await page.getByRole("button", { name: "Close files" }).click();
  await page.locator(".xterm-screen").click();
  await page.keyboard.type("terminal-still-open");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText("terminal-still-open");
});

/** Creates count empty files in a new folder under the served SFTP root. */
function makeFolder(name: string, count: number) {
  const folder = path.join(process.env.E2E_SFTP_ROOT!, name);
  mkdirSync(folder, { recursive: true });
  for (let index = 0; index < count; index++)
    writeFileSync(path.join(folder, `file-${String(index).padStart(5, "0")}.txt`), "");
}

async function openFilesAt(page: Page, folder: string) {
  const address = process.env.E2E_SSHD_ADDR!;
  await page.goto("/");
  await page.getByLabel(/^Host$/i).fill(address.slice(0, address.lastIndexOf(":")));
  await page.getByLabel(/^Port$/i).fill(address.slice(address.lastIndexOf(":") + 1));
  await page.getByLabel(/^Username$/i).fill("tester");
  await page.getByLabel(/^Password$/i).fill("s3cret");
  await page.getByRole("button", { name: /^Connect to server$/i }).click();
  await page.getByRole("button", { name: /trust and connect/i }).click();
  await page.getByRole("button", { name: "Files" }).click();
  await page.getByRole("button", { name: "Go to path" }).click();
  await page.getByLabel("Remote path").fill(folder);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByRole("button", { name: "Go to path" }).click();
  return page.getByRole("region", { name: "Files" });
}

// These folders live under the shared SFTP root, so they are made here, after
// the upload test above has checked the root starts empty.
test("filters and keyboard-scrolls a 2,000-file folder inside the panel", async ({ page }) => {
  makeFolder("many", 2000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const files = await openFilesAt(page, "/many");
  const count = files.getByRole("status").filter({ hasText: "items" });
  await expect(count).toHaveText("2,000 items");
  const grid = files.getByRole("grid", { name: "Files in /many" });
  await expect(grid).toHaveAttribute("aria-rowcount", "2001");
  expect(await grid.getByRole("row").count()).toBeLessThan(60);

  const filter = files.getByRole("searchbox", { name: "Filter files" });
  await filter.fill("FILE-0019");
  await expect(count).toHaveText("10 of 2,000 items");
  await expect(grid.getByRole("row")).toHaveCount(11);
  await filter.fill("");
  await expect(count).toHaveText("2,000 items");

  const body = grid.locator("tbody");
  const pageScroll = () => page.evaluate(() => document.scrollingElement!.scrollTop);
  await grid.getByText("file-00000.txt").click();
  await page.keyboard.press("End");
  const last = grid.getByRole("row", { name: /file-01999\.txt/ });
  await expect(last).toHaveAttribute("aria-selected", "true");
  await expect(last).toHaveAttribute("aria-rowindex", "2001");
  await expect(last.getByRole("gridcell").first()).toBeFocused();
  await expect(last).toBeInViewport();
  expect(await body.evaluate((element) => element.scrollTop)).toBeGreaterThan(50_000);
  expect(await pageScroll()).toBe(0);
  expect(await grid.getByRole("row").count()).toBeLessThan(60);

  await page.keyboard.press("PageUp");
  await expect(grid.getByRole("row", { selected: true })).not.toHaveAttribute(
    "aria-rowindex",
    "2001",
  );
  await body.hover();
  await page.mouse.wheel(0, 5000);
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(55_000);
  await page.mouse.wheel(0, 5000);
  expect(await pageScroll()).toBe(0);
  await page.keyboard.press("Home");
  await expect(grid.getByRole("row", { name: /file-00000\.txt/ })).toBeInViewport();
  expect(await body.evaluate((element) => element.scrollTop)).toBe(0);
  expect(await pageScroll()).toBe(0);
});

test("lists the first 10,000 items of a larger folder and reaches the end", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "CDP is Chromium only");
  test.setTimeout(60_000);
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  makeFolder("huge", 10_050);
  await page.setViewportSize({ width: 1440, height: 900 });
  const files = await openFilesAt(page, "/huge");
  const note = "Showing the first 10,000 items in this folder.";
  await expect(files.getByText(note)).toBeVisible();
  await expect(page.locator(".toast").getByText(note)).toBeVisible();
  await expect(files.getByRole("status").filter({ hasText: "items" })).toHaveText("10,000 items");
  const grid = files.getByRole("grid");
  await grid.getByRole("gridcell").first().focus();
  await page.keyboard.press("End");
  await expect(grid.getByRole("row", { selected: true })).toHaveAttribute("aria-rowindex", "10001");
  expect(await grid.getByRole("row").count()).toBeLessThan(60);
  expect(await page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(0);
});

test("keeps two live terminal sessions and closes only the selected one", async ({ page }) => {
  const address = process.env.E2E_SSHD_ADDR!;
  const host = address.slice(0, address.lastIndexOf(":"));
  const port = address.slice(address.lastIndexOf(":") + 1);
  await page.goto("/");

  const open = async () => {
    await page.getByLabel(/^Host$/i).fill(host);
    await page.getByLabel(/^Port$/i).fill(port);
    await page.getByLabel(/^Username$/i).fill("tester");
    await page.getByLabel(/^Password$/i).fill("s3cret");
    await page.getByRole("button", { name: /^Connect to server$/i }).click();
  };

  await open();
  await page.getByRole("button", { name: /trust and connect/i }).click();
  await expect(page.getByRole("tab", { name: `${host}, connected` })).toHaveCount(1);
  const first = page.getByRole("tabpanel", { name: `${host} terminal` }).first();
  await first.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("first-shell");
  await page.keyboard.press("Enter");
  await expect(first.locator(".xterm-rows")).toContainText("first-shell");

  await page.getByRole("button", { name: "New terminal" }).click();
  await open();
  await expect(page.getByRole("tab", { name: `${host}, connected` })).toHaveCount(2);
  const second = page.getByRole("tabpanel", { name: `${host} terminal` }).last();
  await second.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("second-shell");
  await page.keyboard.press("Enter");
  await expect(second.locator(".xterm-rows")).toContainText("second-shell");
  await expect(second.locator(".xterm-rows")).not.toContainText("first-shell");

  await page.keyboard.press("Control+Alt+Shift+ArrowLeft");
  await expect(page.getByRole("tab", { name: `${host}, connected` }).first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  const switcherButton = page.getByRole("button", { name: "Open terminals" });
  await expect(switcherButton).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Open terminals" })).toHaveCount(0);
  await switcherButton.click();
  const switcher = page.getByRole("tablist", { name: "Open terminals" });
  await expect(switcher.getByRole("tab", { name: `${host}, connected` })).toHaveCount(2);
  const tabSize = await switcher
    .getByRole("tab", { name: `${host}, connected` })
    .first()
    .boundingBox();
  expect(tabSize!.height).toBeGreaterThanOrEqual(44);

  await switcher
    .getByRole("button", { name: `Close ${host} terminal` })
    .last()
    .click();
  await expect(page.getByRole("tab", { name: `${host}, connected` })).toHaveCount(1);
  await expect(first.locator(".xterm-rows")).toContainText("first-shell");
});

test("connects with a private-key file through the relay", async ({ page }) => {
  const address = process.env.E2E_SSHD_ADDR!;
  await page.goto("/");
  await page.getByLabel(/^Host$/i).fill(address.slice(0, address.lastIndexOf(":")));
  await page.getByLabel(/^Port$/i).fill(address.slice(address.lastIndexOf(":") + 1));
  await page.getByLabel(/^Username$/i).fill("tester");
  await page.getByLabel(/^Private key$/i).check();
  await page.getByLabel(/^Private-key file$/i).setInputFiles(process.env.E2E_KEY_PATH!);
  await page.getByRole("button", { name: /^Connect to server$/i }).click();
  await expect(page.getByRole("alertdialog", { name: /verify host key/i })).toBeVisible();
  await page.getByRole("button", { name: /trust and connect/i }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page.locator(".xterm-screen").click();
  await page.keyboard.type("key-login");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText("key-login");
});

test("reports wrong passphrase and rejected key", async ({ page }) => {
  const address = process.env.E2E_SSHD_ADDR!;
  await page.goto("/");
  await page.getByLabel(/^Host$/i).fill(address.slice(0, address.lastIndexOf(":")));
  await page.getByLabel(/^Port$/i).fill(address.slice(address.lastIndexOf(":") + 1));
  await page.getByLabel(/^Username$/i).fill("tester");
  await page.getByLabel(/^Private key$/i).check();
  await page.getByLabel(/^Private-key file$/i).setInputFiles(process.env.E2E_REJECTED_KEY_PATH!);
  await page.getByLabel(/^Key passphrase$/i).fill("wrong");
  await page.getByRole("button", { name: /^Connect to server$/i }).click();
  await expect(page.getByText(/key passphrase did not unlock this key/i)).toBeVisible();
  await page.getByLabel(/^Private-key file$/i).setInputFiles(process.env.E2E_REJECTED_KEY_PATH!);
  await page.getByLabel(/^Key passphrase$/i).fill("secret");
  await page.getByRole("button", { name: /^Connect to server$/i }).click();
  await expect(page.getByRole("alertdialog", { name: /verify host key/i })).toBeVisible();
  await page.getByRole("button", { name: /trust and connect/i }).click();
  await expect(page.getByText("The server did not accept this key.")).toBeVisible();
});

test("keeps the session target clear of the Actions button at 320px", async ({ browser }) => {
  const address = process.env.E2E_SSHD_ADDR!;
  const page = await browser.newPage({ viewport: { width: 320, height: 640 } });
  await page.goto("/");
  await page.getByLabel(/^Host$/i).fill(address.slice(0, address.lastIndexOf(":")));
  await page.getByLabel(/^Port$/i).fill(address.slice(address.lastIndexOf(":") + 1));
  await page.getByLabel(/^Username$/i).fill("tester");
  await page.getByLabel(/^Password$/i).fill("s3cret");
  await page.getByRole("button", { name: /^Connect to server$/i }).click();
  await page.getByRole("button", { name: /trust and connect/i }).click();
  const target = page.locator(".active-target");
  await expect(target).toHaveText(`tester@${address}`);
  const text = await target.boundingBox();
  const actions = await page.getByRole("button", { name: "Actions" }).boundingBox();
  expect(text!.x + text!.width).toBeLessThanOrEqual(actions!.x);
  expect(await target.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.close();
});

for (const width of [320, 390]) {
  test(`keeps toolbar panels on screen at ${width}px`, async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width, height: 700 } });
    await page.goto("/");
    for (const [name, panel] of [
      ["Settings", ".settings-dialog"],
      ["About", ".about__panel"],
    ] as const) {
      await page.getByRole("button", { name, exact: true }).click();
      const box = await page.locator(panel).boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await page.reload();
    }
    await page.close();
  });
}

// Download resume (T13d). OPFS writes are slowed in the page so a download can
// be stopped after its first 4 MiB segment is committed and before it ends.
test.describe("download resume after expiry or eviction", () => {
  const name = "resume.bin";
  const size = 8 << 20;
  const source = Buffer.allocUnsafe(size);
  for (let index = 0; index < size; index++) source[index] = (index * 7 + (index >> 13)) % 251;
  const sourceHash = createHash("sha256").update(source).digest("hex");
  const remoteFile = () => path.join(process.env.E2E_SFTP_ROOT!, name);

  test.beforeEach(() => writeFileSync(remoteFile(), source));
  test.afterEach(() => rmSync(remoteFile(), { force: true }));

  /** Counts bytes written to OPFS and delays each write in proportion to its size. */
  async function slowOpfsWrites(page: Page) {
    await page.addInitScript(() => {
      const state = { bytes: 0, msPer32KiB: 15 };
      Object.assign(window, { testWrites: state });
      const proto = FileSystemWritableFileStream.prototype;
      const original = proto.write;
      proto.write = async function (data: FileSystemWriteChunkType) {
        const length =
          data instanceof Blob ? data.size : ArrayBuffer.isView(data) ? data.byteLength : 0;
        state.bytes += length;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.ceil(length / 32768) * state.msPer32KiB),
        );
        return original.call(this, data);
      };
    });
  }

  function writtenBytes(page: Page) {
    return page.evaluate(
      () => (window as unknown as { testWrites: { bytes: number } }).testWrites.bytes,
    );
  }

  function resetWrittenBytes(page: Page) {
    return page.evaluate(() => {
      (window as unknown as { testWrites: { bytes: number } }).testWrites.bytes = 0;
    });
  }

  /** Fills the connect form; the host key prompt appears only on the first visit. */
  async function login(page: Page, tap: boolean, firstVisit = true) {
    const address = process.env.E2E_SSHD_ADDR!;
    await page.getByLabel(/^Host$/i).fill(address.slice(0, address.lastIndexOf(":")));
    await page.getByLabel(/^Port$/i).fill(address.slice(address.lastIndexOf(":") + 1));
    await page.getByLabel(/^Username$/i).fill("tester");
    await page.getByLabel(/^Password$/i).fill("s3cret");
    const connect = page.getByRole("button", { name: /^Connect to server$/i });
    await (tap ? connect.tap() : connect.click());
    if (!firstVisit) return;
    const trust = page.getByRole("button", { name: /trust and connect/i });
    await (tap ? trust.tap() : trust.click());
  }

  /** Starts the download from the row and waits until more than half is written. */
  async function downloadPastHalf(page: Page) {
    // Desktop rows show their download button on hover or selection.
    await page.getByRole("row").filter({ hasText: name }).click();
    await page.getByRole("button", { name: `Download file ${name}` }).click();
    await expect(page.getByText(new RegExp(`Downloading ${name}: (5[5-9]|[6-9]\\d)%`))).toBeVisible(
      {
        timeout: 20_000,
      },
    );
  }

  async function savedHash(download: Promise<import("@playwright/test").Download>) {
    const stream = await (await download).createReadStream();
    const hash = createHash("sha256");
    for await (const chunk of stream) hash.update(chunk as Buffer);
    return hash.digest("hex");
  }

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test("resumes an 8 MiB download by offset after the session expires and Reconnect", async ({
      page,
    }) => {
      test.setTimeout(90_000);
      const relayPort = await new Promise<number>((resolve, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const bound = server.address();
          server.close(() => resolve(typeof bound === "object" && bound ? bound.port : 0));
        });
      });
      const relay = spawn("npm", ["run", "relay:local", "--", String(relayPort)], {
        cwd: path.resolve("../relay"),
        env: { ...process.env, KEEPALIVE_MAX_SECONDS: "2" },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
      await new Promise<void>((resolve, reject) => {
        relay.stdout.on("data", (data: Buffer) => {
          if (data.toString().includes(`local relay listening on ${relayPort}`)) resolve();
        });
        relay.once("exit", (code) => reject(new Error(`short-grace relay exited: ${code}`)));
      });
      try {
        await page.addInitScript((target) => {
          const Original = window.WebSocket;
          const sockets: WebSocket[] = [];
          Object.assign(window, { testSockets: sockets });
          window.WebSocket = class extends Original {
            constructor(url: string | URL, protocols?: string | string[]) {
              super(String(url).replace(/127\.0\.0\.1:\d+/, target), protocols);
              sockets.push(this);
            }
          };
        }, `127.0.0.1:${relayPort}`);
        await slowOpfsWrites(page);
        await page.goto("/");
        await login(page, true);
        await expect(page.getByRole("toolbar", { name: "Terminal keys" })).toBeVisible();
        await page.getByRole("button", { name: "Actions" }).tap();
        await page
          .getByRole("group", { name: "Actions" })
          .getByRole("button", { name: "Files" })
          .tap();
        await downloadPastHalf(page);

        await page.evaluate(async () => {
          window.dispatchEvent(new Event("pagehide"));
          (window as unknown as { testSockets: WebSocket[] }).testSockets.at(-1)?.close();
          await new Promise((resolve) => setTimeout(resolve, 3_000));
          window.dispatchEvent(new Event("pageshow"));
        });
        await expect(page.getByText("Session expired.").first()).toBeVisible();
        await expect(
          page.getByText(new RegExp(`Download of ${name} stopped at \\d+%\\.`)),
        ).toBeVisible();
        await page.getByRole("button", { name: "Reconnect" }).tap();
        await page.getByLabel(/^Password$/i).fill("s3cret");
        await page.getByRole("button", { name: /^Connect to server$/i }).tap();
        await expect(page.getByRole("toolbar", { name: "Terminal keys" })).toBeVisible();

        const files = page.getByRole("region", { name: "Files" });
        if (!(await files.isVisible())) {
          await page.getByRole("button", { name: "Actions" }).tap();
          await page
            .getByRole("group", { name: "Actions" })
            .getByRole("button", { name: "Files" })
            .tap();
        }
        await expect(
          files.getByText(`${name} stopped at 50% when the connection closed.`),
        ).toBeVisible();
        await resetWrittenBytes(page);
        const saved = page.waitForEvent("download");
        await files.getByRole("button", { name: "Resume download" }).tap();
        expect(await savedHash(saved)).toBe(sourceHash);
        expect(await writtenBytes(page)).toBe(size - (4 << 20));
      } finally {
        process.kill(-relay.pid!, "SIGKILL");
      }
    });
  });

  test("offers resume after reload, restarts on a changed file or a missing segment", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await slowOpfsWrites(page);
    await page.goto("/");
    await login(page, false);
    await page.getByRole("button", { name: "Files" }).click();
    const files = page.getByRole("region", { name: "Files" });
    await downloadPastHalf(page);

    // Reload with a committed segment: resume is offered after login.
    await page.reload();
    await login(page, false, false);
    await page.getByRole("button", { name: "Files" }).click();
    await expect(
      files.getByText(`${name} stopped at 50% when the connection closed.`),
    ).toBeVisible();

    // The remote file changes: X-06, and Retry downloads it whole.
    utimesSync(remoteFile(), new Date(2001, 0, 1), new Date(2001, 0, 1));
    await files.getByRole("button", { name: "Resume download" }).click();
    await expect(
      files.getByText("It changed on the server after the download started."),
    ).toBeVisible();
    await expect(files.getByRole("button", { name: "Resume download" })).toHaveCount(0);
    await resetWrittenBytes(page);
    let saved = page.waitForEvent("download");
    await files.getByRole("button", { name: "Retry" }).click();
    expect(await savedHash(saved)).toBe(sourceHash);
    expect(await writtenBytes(page)).toBe(size);

    // A segment lost to storage eviction: Resume restarts cleanly from 0.
    await downloadPastHalf(page);
    await page.reload();
    await login(page, false, false);
    await page.getByRole("button", { name: "Files" }).click();
    const resume = files.getByRole("button", { name: "Resume download" });
    await expect(resume).toBeVisible();
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("localssh-downloads");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const records = await new Promise<{ createdAt: number; segments: string[] }[]>(
        (resolve, reject) => {
          const request = db.transaction("downloads").objectStore("downloads").getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        },
      );
      db.close();
      const latest = records.sort((a, b) => b.createdAt - a.createdAt)[0]!;
      await (await navigator.storage.getDirectory()).removeEntry(latest.segments[0]!);
    });
    await resetWrittenBytes(page);
    saved = page.waitForEvent("download");
    await resume.click();
    expect(await savedHash(saved)).toBe(sourceHash);
    expect(await writtenBytes(page)).toBe(size);
  });
});
