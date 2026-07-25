import { describe, expect, it, vi } from "vitest";
import { createServer, connect as netConnect, type AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { startLocalRelay } from "./local-relay.js";
import { parseAccessConfig } from "./access.js";
import { encodeConnectFrame } from "./protocol.js";

describe("local relay", () => {
  it("rejects a WebSocket origin outside the configured allowlist", async () => {
    const wss = startLocalRelay({
      port: 0,
      accessConfig: parseAccessConfig({
        ALLOWED_ORIGINS: "http://localhost:8080",
        ALLOWED_HOSTS: "*",
      }),
    });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const relayPort = (wss.address() as AddressInfo).port;

    const client = new WebSocket(`ws://127.0.0.1:${relayPort}`, {
      origin: "https://evil.example",
    });
    client.on("error", () => {});
    const status = await new Promise<number>((resolve) => {
      client.once("unexpected-response", (_request, response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
    });

    expect(status).toBe(403);
    wss.close();
  });

  it("closes a target outside the configured allowlist", async () => {
    const wss = startLocalRelay({
      port: 0,
      accessConfig: parseAccessConfig({
        ALLOWED_ORIGINS: "http://localhost:8080",
        ALLOWED_HOSTS: "ssh.example.com",
      }),
    });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const relayPort = (wss.address() as AddressInfo).port;

    const client = new WebSocket(`ws://127.0.0.1:${relayPort}`, {
      origin: "http://localhost:8080",
    });
    await new Promise<void>((resolve) => client.once("open", resolve));
    const closed = new Promise<number>((resolve) => client.once("close", resolve));
    client.send(encodeConnectFrame({ host: "evil.example", port: 22 }));

    expect(await closed).toBe(1008);
    wss.close();
  });

  it("logs a rejected origin so the operator can see the misconfiguration", async () => {
    const log = vi.fn();
    const wss = startLocalRelay({
      port: 0,
      log,
      accessConfig: parseAccessConfig({
        ALLOWED_ORIGINS: "http://localhost:8080",
        ALLOWED_HOSTS: "*",
      }),
    });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const relayPort = (wss.address() as AddressInfo).port;

    const client = new WebSocket(`ws://127.0.0.1:${relayPort}`, {
      origin: "http://192.168.1.20:9080",
    });
    client.on("error", () => {});
    await new Promise<void>((resolve) => {
      client.once("unexpected-response", (_request, response) => {
        response.resume();
        resolve();
      });
    });

    const message = log.mock.calls.map(([line]) => String(line)).join("\n");
    expect(message).toContain("http://192.168.1.20:9080");
    expect(message).toContain("ALLOWED_ORIGINS");
    wss.close();
  });

  // Behind the bundled nginx every socket comes from the proxy, so the log line
  // would otherwise never name the device that was refused.
  it("names the forwarded client address in a refusal", async () => {
    const log = vi.fn();
    const wss = startLocalRelay({
      port: 0,
      log,
      accessConfig: parseAccessConfig({
        ALLOWED_ORIGINS: "http://localhost:8080",
        ALLOWED_HOSTS: "*",
      }),
    });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const relayPort = (wss.address() as AddressInfo).port;

    const client = new WebSocket(`ws://127.0.0.1:${relayPort}`, {
      origin: "http://192.168.1.20:9080",
      headers: { "x-forwarded-for": "192.168.1.55, 172.19.0.3" },
    });
    client.on("error", () => {});
    await new Promise<void>((resolve) => {
      client.once("unexpected-response", (_request, response) => {
        response.resume();
        resolve();
      });
    });

    expect(log.mock.calls.map(([line]) => String(line)).join("\n")).toContain("192.168.1.55");
    wss.close();
  });

  it("logs a rejected target with the origin that asked for it", async () => {
    const log = vi.fn();
    const wss = startLocalRelay({
      port: 0,
      log,
      accessConfig: parseAccessConfig({
        ALLOWED_ORIGINS: "http://localhost:8080",
        ALLOWED_HOSTS: "ssh.example.com",
      }),
    });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const relayPort = (wss.address() as AddressInfo).port;

    const client = new WebSocket(`ws://127.0.0.1:${relayPort}`, {
      origin: "http://localhost:8080",
    });
    await new Promise<void>((resolve) => client.once("open", resolve));
    const closed = new Promise<number>((resolve) => client.once("close", resolve));
    client.send(encodeConnectFrame({ host: "evil.example", port: 22 }));
    await closed;

    const message = log.mock.calls.map(([line]) => String(line)).join("\n");
    expect(message).toContain("evil.example");
    expect(message).toContain("http://localhost:8080");
    expect(message).toContain("ALLOWED_HOSTS");
    wss.close();
  });

  it("pipes bytes between a WebSocket client and a raw TCP target", async () => {
    const echoServer = createServer((socket) => socket.pipe(socket));
    await new Promise<void>((resolve) => echoServer.listen(0, "127.0.0.1", resolve));
    const echoPort = (echoServer.address() as AddressInfo).port;

    const wss = startLocalRelay({ port: 0 });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const relayPort = (wss.address() as AddressInfo).port;

    const client = new WebSocket(`ws://127.0.0.1:${relayPort}`);
    await new Promise<void>((resolve) => client.once("open", resolve));

    client.send(encodeConnectFrame({ host: "127.0.0.1", port: echoPort }));

    const echoed = new Promise<Buffer>((resolve) => {
      client.once("message", (data) => resolve(data as Buffer));
    });
    client.send(Buffer.from("ping"));

    expect((await echoed).toString()).toBe("ping");

    client.close();
    wss.close();
    echoServer.close();
  });

  it("closes the socket on an invalid first frame", async () => {
    const wss = startLocalRelay({ port: 0 });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const relayPort = (wss.address() as AddressInfo).port;

    const client = new WebSocket(`ws://127.0.0.1:${relayPort}`);
    await new Promise<void>((resolve) => client.once("open", resolve));

    const closed = new Promise<number>((resolve) => client.once("close", (code) => resolve(code)));
    client.send("not a connect frame");

    expect(await closed).toBe(1002);

    wss.close();
  });

  it("closes a client that never sends a connect frame", async () => {
    const wss = startLocalRelay({ port: 0, connectFrameTimeoutMs: 50 });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const relayPort = (wss.address() as AddressInfo).port;

    const client = new WebSocket(`ws://127.0.0.1:${relayPort}`);
    await new Promise<void>((resolve) => client.once("open", resolve));

    const closed = new Promise<number>((resolve) => client.once("close", (code) => resolve(code)));
    expect(await closed).toBe(1002);

    wss.close();
  });

  // Drives enough data through to cross both watermarks in both directions.
  // Pausing and resuming must not drop, duplicate, or reorder a single byte.
  it("relays a large transfer intact while throttling", async () => {
    const echoServer = createServer((socket) => socket.pipe(socket));
    await new Promise<void>((resolve) => echoServer.listen(0, "127.0.0.1", resolve));
    const echoPort = (echoServer.address() as AddressInfo).port;

    const wss = startLocalRelay({ port: 0 });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const relayPort = (wss.address() as AddressInfo).port;

    const client = new WebSocket(`ws://127.0.0.1:${relayPort}`);
    client.binaryType = "nodebuffer";
    await new Promise<void>((resolve) => client.once("open", resolve));
    client.send(encodeConnectFrame({ host: "127.0.0.1", port: echoPort }));

    const CHUNK = 64 * 1024;
    const CHUNKS = 128; // 8 MiB, well past both watermarks
    const payload = Buffer.alloc(CHUNK * CHUNKS);
    for (let i = 0; i < payload.length; i++) payload[i] = i % 251;

    const received: Buffer[] = [];
    const done = new Promise<void>((resolve) => {
      client.on("message", (data) => {
        received.push(data as Buffer);
        if (Buffer.concat(received).length >= payload.length) resolve();
      });
    });

    for (let i = 0; i < CHUNKS; i++) {
      client.send(payload.subarray(i * CHUNK, (i + 1) * CHUNK));
    }

    await done;
    expect(Buffer.concat(received).subarray(0, payload.length).equals(payload)).toBe(true);

    client.close();
    wss.close();
    echoServer.close();
  }, 30_000);

  // Integrity check for the target-to-client path under a flood, with the
  // watermarks set very low. Note this does not prove the pause branch runs:
  // over loopback ws.bufferedAmount stays at zero because send() reaches the
  // kernel before it is read back, so the pause never triggers here. It does
  // prove the watermark bookkeeping and the resume callback cannot drop or
  // corrupt data on the common path.
  it("relays a flooding target without corrupting the stream", async () => {
    const TOTAL = 4 * 1024 * 1024;
    const floodServer = createServer((socket) => {
      const chunk = Buffer.alloc(64 * 1024, 0x7a);
      let sent = 0;
      const pump = () => {
        while (sent < TOTAL) {
          const size = Math.min(chunk.length, TOTAL - sent);
          sent += size;
          if (!socket.write(chunk.subarray(0, size))) {
            socket.once("drain", pump);
            return;
          }
        }
      };
      pump();
    });
    await new Promise<void>((resolve) => floodServer.listen(0, "127.0.0.1", resolve));
    const floodPort = (floodServer.address() as AddressInfo).port;

    const wss = startLocalRelay({
      port: 0,
      pauseWatermarkBytes: 4 * 1024,
      resumeWatermarkBytes: 1024,
    });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const relayPort = (wss.address() as AddressInfo).port;

    const client = new WebSocket(`ws://127.0.0.1:${relayPort}`);
    client.binaryType = "nodebuffer";
    await new Promise<void>((resolve) => client.once("open", resolve));
    client.send(encodeConnectFrame({ host: "127.0.0.1", port: floodPort }));

    let bytes = 0;
    let corrupt = false;
    await new Promise<void>((resolve) => {
      client.on("message", (data) => {
        const buf = data as Buffer;
        for (const byte of buf) if (byte !== 0x7a) corrupt = true;
        bytes += buf.length;
        if (bytes >= TOTAL) resolve();
      });
    });

    expect(corrupt).toBe(false);
    expect(bytes).toBe(TOTAL);

    client.close();
    wss.close();
    floodServer.close();
  }, 30_000);

  // A malformed frame makes `ws` emit 'error' on the server-side socket. With
  // no listener attached Node raises ERR_UNHANDLED_ERROR, which killed the
  // whole relay process and every concurrent session with it.
  it("survives a client sending a malformed frame", async () => {
    const echoServer = createServer((socket) => socket.pipe(socket));
    await new Promise<void>((resolve) => echoServer.listen(0, "127.0.0.1", resolve));
    const echoPort = (echoServer.address() as AddressInfo).port;

    const wss = startLocalRelay({ port: 0 });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const relayPort = (wss.address() as AddressInfo).port;

    await sendMalformedTextFrame(relayPort);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const survivor = new WebSocket(`ws://127.0.0.1:${relayPort}`);
    await new Promise<void>((resolve) => survivor.once("open", resolve));
    survivor.send(encodeConnectFrame({ host: "127.0.0.1", port: echoPort }));

    const echoed = new Promise<Buffer>((resolve) => {
      survivor.once("message", (data) => resolve(data as Buffer));
    });
    survivor.send(Buffer.from("still alive"));
    expect((await echoed).toString()).toBe("still alive");

    survivor.close();
    wss.close();
    echoServer.close();
  });
});

// Completes a WebSocket handshake by hand, then sends a text frame whose
// payload is not valid UTF-8. The `ws` client cannot express this.
async function sendMalformedTextFrame(port: number): Promise<void> {
  const socket = netConnect(port, "127.0.0.1");
  socket.on("error", () => {});
  await new Promise<void>((resolve) => socket.once("connect", () => resolve()));

  socket.write(
    `GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\n` +
      `Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n` +
      `Sec-WebSocket-Version: 13\r\n\r\n`,
  );
  await new Promise<void>((resolve) => socket.once("data", () => resolve()));

  const payload = Buffer.from([0xff, 0xfe, 0xfd]);
  const mask = Buffer.from([1, 2, 3, 4]);
  const masked = Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]!));
  socket.write(Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, masked]));

  socket.destroy();
}
