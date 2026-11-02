import { describe, expect, it, vi } from "vitest";
import { createServer, connect as netConnect, Socket, type AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { closeLocalRelay, startLocalRelay } from "./local-relay.js";
import { parseAccessConfig } from "./access.js";
import { decodeV2Frame, encodeConnectFrame, encodeV2Frame, type V2Frame } from "./protocol.js";

async function openRelayClient(port: number, origin?: string): Promise<WebSocket> {
  const client = new WebSocket(`ws://127.0.0.1:${port}`, origin ? { origin } : undefined);
  await new Promise<void>((resolve) => client.once("open", resolve));
  return client;
}

function nextV2Frame(client: WebSocket): Promise<V2Frame> {
  return new Promise((resolve) =>
    client.once("message", (data) => resolve(decodeV2Frame(data.toString()))),
  );
}

describe("local relay", () => {
  it("replays server bytes after transport loss until the consumer ACKs them", async () => {
    const target = createServer((socket) => socket.write("output"));
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    const wss = startLocalRelay({ port: 0, maxGraceMs: 120_000 });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const port = (wss.address() as AddressInfo).port;
    const first = await openRelayClient(port);
    const frames: V2Frame[] = [];
    first.on("message", (data) => frames.push(decodeV2Frame(data.toString())));
    first.send(
      encodeV2Frame({
        version: 2,
        type: "connect",
        host: "127.0.0.1",
        port: (target.address() as AddressInfo).port,
        requestedGraceMs: 120000,
      }),
    );
    await vi.waitFor(() => expect(frames.some((frame) => frame.type === "data")).toBe(true));
    const ready = frames.find((frame) => frame.type === "ready");
    if (ready?.type !== "ready") throw new Error("expected ready");
    first.terminate();
    await new Promise<void>((resolve) => first.once("close", resolve));
    const second = await openRelayClient(port);
    const resumed = nextV2Frame(second);
    const replay = new Promise<V2Frame>((resolve) => {
      let count = 0;
      second.on("message", (data) => {
        if (++count === 2) resolve(decodeV2Frame(data.toString()));
      });
    });
    second.send(
      encodeV2Frame({
        version: 2,
        type: "resume",
        sessionId: ready.sessionId,
        token: ready.token,
        clientAck: 0,
        serverAck: 0,
      }),
    );
    const resumedFrame = await resumed;
    expect(resumedFrame).toMatchObject({ type: "resumed", serverAck: 0 });
    if (resumedFrame.type !== "resumed") throw new Error("expected resumed");
    const replayed = await replay;
    expect(replayed).toMatchObject({ type: "data", direction: "server", offset: 0 });
    if (replayed.type !== "data") throw new Error("expected data");
    expect(Buffer.from(replayed.payload).toString()).toBe("output");
    second.send(encodeV2Frame({ version: 2, type: "ack", direction: "server", offset: 6 }));
    second.send(encodeV2Frame({ version: 2, type: "detach" }));
    await new Promise<void>((resolve) => second.once("close", resolve));
    const third = await openRelayClient(port);
    const thirdFrames: V2Frame[] = [];
    third.on("message", (data) => thirdFrames.push(decodeV2Frame(data.toString())));
    third.send(
      encodeV2Frame({
        version: 2,
        type: "resume",
        sessionId: ready.sessionId,
        token: resumedFrame.newToken,
        clientAck: 0,
        serverAck: 6,
      }),
    );
    await vi.waitFor(() => expect(thirdFrames).toHaveLength(1));
    expect(thirdFrames[0]).toMatchObject({ type: "resumed", serverAck: 6 });
    await closeLocalRelay(wss);
    await new Promise<void>((resolve) => target.close(() => resolve()));
  });

  it("deduplicates accepted input across resume and rejects conflicting overlap", async () => {
    const received: Buffer[] = [];
    const target = createServer((socket) => socket.on("data", (chunk) => received.push(chunk)));
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    const wss = startLocalRelay({ port: 0, maxGraceMs: 120_000 });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const port = (wss.address() as AddressInfo).port;
    const first = await openRelayClient(port);
    const readyFrame = nextV2Frame(first);
    first.send(
      encodeV2Frame({
        version: 2,
        type: "connect",
        host: "127.0.0.1",
        port: (target.address() as AddressInfo).port,
        requestedGraceMs: 120000,
      }),
    );
    const ready = await readyFrame;
    if (ready.type !== "ready") throw new Error("expected ready");
    const ack = nextV2Frame(first);
    first.send(
      encodeV2Frame({
        version: 2,
        type: "data",
        direction: "client",
        offset: 0,
        payload: Buffer.from("once"),
      }),
    );
    expect(await ack).toMatchObject({ type: "ack", direction: "client", offset: 4 });
    first.terminate();
    await new Promise<void>((resolve) => first.once("close", resolve));
    const second = await openRelayClient(port);
    const resumed = nextV2Frame(second);
    second.send(
      encodeV2Frame({
        version: 2,
        type: "resume",
        sessionId: ready.sessionId,
        token: ready.token,
        clientAck: 0,
        serverAck: 0,
      }),
    );
    expect(await resumed).toMatchObject({ type: "resumed", clientAck: 4 });
    const duplicateAck = nextV2Frame(second);
    second.send(
      encodeV2Frame({
        version: 2,
        type: "data",
        direction: "client",
        offset: 0,
        payload: Buffer.from("once"),
      }),
    );
    expect(await duplicateAck).toMatchObject({ type: "ack", offset: 4 });
    await vi.waitFor(() => expect(Buffer.concat(received).toString()).toBe("once"));
    const error = nextV2Frame(second);
    second.send(
      encodeV2Frame({
        version: 2,
        type: "data",
        direction: "client",
        offset: 0,
        payload: Buffer.from("evil"),
      }),
    );
    expect(await error).toMatchObject({ type: "error", code: "offset_mismatch" });
    await closeLocalRelay(wss);
    await new Promise<void>((resolve) => target.close(() => resolve()));
  });

  it("accepts matching partial overlap, closes a gap, and isolates another session", async () => {
    const received: Buffer[][] = [];
    const target = createServer((socket) => {
      const chunks: Buffer[] = [];
      received.push(chunks);
      socket.on("data", (chunk) => chunks.push(chunk));
    });
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    const wss = startLocalRelay({ port: 0, maxGraceMs: 120_000 });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const clients = await Promise.all([
      openRelayClient((wss.address() as AddressInfo).port),
      openRelayClient((wss.address() as AddressInfo).port),
    ]);
    for (const client of clients) {
      const ready = nextV2Frame(client);
      client.send(
        encodeV2Frame({
          version: 2,
          type: "connect",
          host: "127.0.0.1",
          port: (target.address() as AddressInfo).port,
          requestedGraceMs: 120000,
        }),
      );
      expect((await ready).type).toBe("ready");
    }
    const firstAck = nextV2Frame(clients[0]);
    clients[0].send(
      encodeV2Frame({
        version: 2,
        type: "data",
        direction: "client",
        offset: 0,
        payload: Buffer.from("abc"),
      }),
    );
    expect(await firstAck).toMatchObject({ type: "ack", offset: 3 });
    const overlapAck = nextV2Frame(clients[0]);
    clients[0].send(
      encodeV2Frame({
        version: 2,
        type: "data",
        direction: "client",
        offset: 1,
        payload: Buffer.from("bcd"),
      }),
    );
    expect(await overlapAck).toMatchObject({ type: "ack", offset: 4 });
    const gapError = nextV2Frame(clients[0]);
    clients[0].send(
      encodeV2Frame({
        version: 2,
        type: "data",
        direction: "client",
        offset: 5,
        payload: Buffer.from("x"),
      }),
    );
    expect(await gapError).toMatchObject({ type: "error", code: "offset_mismatch" });
    const secondAck = nextV2Frame(clients[1]);
    clients[1].send(
      encodeV2Frame({
        version: 2,
        type: "data",
        direction: "client",
        offset: 0,
        payload: Buffer.from("safe"),
      }),
    );
    expect(await secondAck).toMatchObject({ type: "ack", offset: 4 });
    await vi.waitFor(() =>
      expect(received.map((chunks) => Buffer.concat(chunks).toString())).toEqual(["abcd", "safe"]),
    );
    await closeLocalRelay(wss);
    await new Promise<void>((resolve) => target.close(() => resolve()));
  });

  it("holds outbound replay when WebSocket buffered bytes reach the cap", async () => {
    let targetSocket: Socket | undefined;
    const target = createServer((socket) => {
      targetSocket = socket;
    });
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    const wss = startLocalRelay({ port: 0, maxGraceMs: 120_000 });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const client = await openRelayClient((wss.address() as AddressInfo).port);
    const frames: V2Frame[] = [];
    client.on("message", (data) => frames.push(decodeV2Frame(data.toString())));
    client.send(
      encodeV2Frame({
        version: 2,
        type: "connect",
        host: "127.0.0.1",
        port: (target.address() as AddressInfo).port,
        requestedGraceMs: 120000,
      }),
    );
    await vi.waitFor(() => expect(frames[0]?.type).toBe("ready"));
    const serverWs = [...wss.clients][0];
    const originalSend = serverWs.send.bind(serverWs);
    let buffered = 0;
    Object.defineProperty(serverWs, "bufferedAmount", { get: () => buffered });
    serverWs.send = ((data: string, callback?: (error?: Error) => void) => {
      buffered += Buffer.byteLength(data);
      originalSend(data, callback);
    }) as typeof serverWs.send;
    targetSocket!.write(Buffer.alloc(256 * 1024, 7));
    await vi.waitFor(() => expect(buffered).toBeGreaterThanOrEqual(128 * 1024));
    const sent = frames
      .filter((frame) => frame.type === "data")
      .reduce((n, frame) => n + (frame.type === "data" ? frame.payload.length : 0), 0);
    expect(sent).toBeLessThan(256 * 1024);
    buffered = 0;
    client.send(encodeV2Frame({ version: 2, type: "ack", direction: "server", offset: 0 }));
    await vi.waitFor(() =>
      expect(
        frames
          .filter((frame) => frame.type === "data")
          .reduce((n, frame) => n + (frame.type === "data" ? frame.payload.length : 0), 0),
      ).toBeGreaterThan(sent),
    );
    await closeLocalRelay(wss);
    await new Promise<void>((resolve) => target.close(() => resolve()));
  });
  it("keeps v1 close behavior when resumable sessions are disabled", async () => {
    const target = createServer();
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    let outbound: Socket | undefined;
    const wss = startLocalRelay({
      port: 0,
      targetConnector: (options) => (outbound = netConnect(options)),
    });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const client = await openRelayClient((wss.address() as AddressInfo).port);
    client.send(
      encodeConnectFrame({ host: "127.0.0.1", port: (target.address() as AddressInfo).port }),
    );
    await vi.waitFor(() => expect(outbound?.connecting).toBe(false));
    client.close();
    await new Promise<void>((resolve) => client.once("close", resolve));
    expect(outbound?.destroyed).toBe(true);
    await closeLocalRelay(wss);
    await new Promise<void>((resolve) => target.close(() => resolve()));
  });
  it("grants min(requested, 120000) in ready and rotates the token in resumed", async () => {
    const target = createServer();
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    const targetPort = (target.address() as AddressInfo).port;
    const wss = startLocalRelay({ port: 0, maxGraceMs: 120_000 });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const port = (wss.address() as AddressInfo).port;
    const connectWith = async (requestedGraceMs: number | null) => {
      const client = await openRelayClient(port);
      const readyFrame = nextV2Frame(client);
      client.send(
        encodeV2Frame({
          version: 2,
          type: "connect",
          host: "127.0.0.1",
          port: targetPort,
          requestedGraceMs,
        }),
      );
      const ready = await readyFrame;
      if (ready.type !== "ready") throw new Error("expected ready");
      return { client, ready };
    };
    const short = await connectWith(5000);
    expect(short.ready).toMatchObject({
      maxUnackedBytes: 262144,
      grantedGraceMs: 5000,
      capGraceMs: 120000,
    });
    expect((await connectWith(3_600_000)).ready).toMatchObject({
      grantedGraceMs: 120000,
      capGraceMs: 120000,
    });
    expect((await connectWith(null)).ready).toMatchObject({
      grantedGraceMs: 120000,
      capGraceMs: 120000,
    });

    short.client.send(encodeV2Frame({ version: 2, type: "detach" }));
    await new Promise<void>((resolve) => short.client.once("close", resolve));
    const second = await openRelayClient(port);
    const resumed = nextV2Frame(second);
    second.send(
      encodeV2Frame({
        version: 2,
        type: "resume",
        sessionId: short.ready.sessionId,
        token: short.ready.token,
        clientAck: 0,
        serverAck: 0,
      }),
    );
    const resumedFrame = await resumed;
    expect(resumedFrame).toMatchObject({ version: 2, type: "resumed", clientAck: 0, serverAck: 0 });
    if (resumedFrame.type !== "resumed") throw new Error("expected resumed");
    expect(resumedFrame.newToken).toMatch(/^[0-9a-f]{64}$/);
    expect(resumedFrame.newToken).not.toBe(short.ready.token);
    await closeLocalRelay(wss);
    await new Promise<void>((resolve) => target.close(() => resolve()));
  });

  it("expires a detached session at its granted grace", async () => {
    const target = createServer();
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    const sockets: Socket[] = [];
    const wss = startLocalRelay({
      port: 0,
      maxGraceMs: 120_000,
      targetConnector: (options) => {
        const socket = netConnect(options);
        sockets.push(socket);
        return socket;
      },
    });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const client = await openRelayClient((wss.address() as AddressInfo).port);
    const readyFrame = nextV2Frame(client);
    client.send(
      encodeV2Frame({
        version: 2,
        type: "connect",
        host: "127.0.0.1",
        port: (target.address() as AddressInfo).port,
        requestedGraceMs: 5000,
      }),
    );
    expect((await readyFrame).type).toBe("ready");
    vi.useFakeTimers();
    try {
      client.close();
      await new Promise<void>((resolve) => client.once("close", resolve));
      await vi.advanceTimersByTimeAsync(4999);
      expect(sockets[0].destroyed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(sockets[0].destroyed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
    await closeLocalRelay(wss);
    await new Promise<void>((resolve) => target.close(() => resolve()));
  });

  it("answers ping with pong and revokes the session on an explicit close frame", async () => {
    const target = createServer();
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    const sockets: Socket[] = [];
    const wss = startLocalRelay({
      port: 0,
      maxGraceMs: 120_000,
      targetConnector: (options) => {
        const socket = netConnect(options);
        sockets.push(socket);
        return socket;
      },
    });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const port = (wss.address() as AddressInfo).port;
    const client = await openRelayClient(port);
    const readyFrame = nextV2Frame(client);
    client.send(
      encodeV2Frame({
        version: 2,
        type: "connect",
        host: "127.0.0.1",
        port: (target.address() as AddressInfo).port,
        requestedGraceMs: 120000,
      }),
    );
    const ready = await readyFrame;
    if (ready.type !== "ready") throw new Error("expected ready");
    const pong = nextV2Frame(client);
    client.send(encodeV2Frame({ version: 2, type: "ping" }));
    expect(await pong).toEqual({ version: 2, type: "pong" });
    expect(sockets[0].destroyed).toBe(false);

    const closed = new Promise<void>((resolve) => client.once("close", () => resolve()));
    client.send(encodeV2Frame({ version: 2, type: "close" }));
    await closed;
    expect(sockets[0].destroyed).toBe(true);
    const late = await openRelayClient(port);
    const denied = nextV2Frame(late);
    late.send(
      encodeV2Frame({
        version: 2,
        type: "resume",
        sessionId: ready.sessionId,
        token: ready.token,
        clientAck: 0,
        serverAck: 0,
      }),
    );
    expect(await denied).toMatchObject({ type: "error", code: "expired" });
    await closeLocalRelay(wss);
    await new Promise<void>((resolve) => target.close(() => resolve()));
  });

  it("retains a v2 target across detach and permits one same-origin resume", async () => {
    const target = createServer();
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    const targetPort = (target.address() as AddressInfo).port;
    const sockets: Socket[] = [];
    const log = vi.fn();
    const wss = startLocalRelay({
      port: 0,
      maxGraceMs: 120_000,
      log,
      targetConnector: (options) => {
        const socket = netConnect(options);
        sockets.push(socket);
        return socket;
      },
    });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const port = (wss.address() as AddressInfo).port;
    const first = await openRelayClient(port, "http://localhost:8080");
    const readyFrame = nextV2Frame(first);
    first.send(
      encodeV2Frame({
        version: 2,
        type: "connect",
        host: "127.0.0.1",
        port: targetPort,
        requestedGraceMs: 120000,
      }),
    );
    const ready = await readyFrame;
    expect(ready.type).toBe("ready");
    if (ready.type !== "ready") throw new Error("expected ready");
    expect(ready.token).toMatch(/^[0-9a-f]{64}$/);
    expect(ready.sessionId).toMatch(/^[0-9a-f]{32}$/);

    first.send(encodeV2Frame({ version: 2, type: "detach" }));
    await new Promise<void>((resolve) => first.once("close", resolve));
    expect(sockets[0].destroyed).toBe(false);
    const resume = {
      version: 2,
      type: "resume",
      sessionId: ready.sessionId,
      token: ready.token,
      clientAck: 0,
      serverAck: 0,
    } as const;
    const wrongOrigin = await openRelayClient(port, "http://elsewhere.test");
    const denied = nextV2Frame(wrongOrigin);
    wrongOrigin.send(encodeV2Frame(resume));
    expect(await denied).toMatchObject({ type: "error", code: "expired" });
    const second = await openRelayClient(port, "http://localhost:8080");
    const resumed = nextV2Frame(second);
    second.send(encodeV2Frame(resume));
    expect(await resumed).toMatchObject({ type: "resumed" });
    expect(sockets).toHaveLength(1);
    expect(log.mock.calls.flat().join("\n")).not.toContain(ready.token);
    await closeLocalRelay(wss);
    expect(sockets[0].destroyed).toBe(true);
    await new Promise<void>((resolve) => target.close(() => resolve()));
  });

  it("rejects an invalid token and expires a detached target after 120 seconds", async () => {
    const target = createServer();
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    const sockets: Socket[] = [];
    const wss = startLocalRelay({
      port: 0,
      maxGraceMs: 120_000,
      targetConnector: (options) => {
        const socket = netConnect(options);
        sockets.push(socket);
        return socket;
      },
    });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const port = (wss.address() as AddressInfo).port;
    const client = await openRelayClient(port);
    const readyFrame = nextV2Frame(client);
    client.send(
      encodeV2Frame({
        version: 2,
        type: "connect",
        host: "127.0.0.1",
        port: (target.address() as AddressInfo).port,
        requestedGraceMs: 120000,
      }),
    );
    const ready = await readyFrame;
    if (ready.type !== "ready") throw new Error("expected ready");
    vi.useFakeTimers();
    client.close();
    await new Promise<void>((resolve) => client.once("close", resolve));

    const invalid = await openRelayClient(port);
    const denied = nextV2Frame(invalid);
    invalid.send(
      encodeV2Frame({
        version: 2,
        type: "resume",
        sessionId: ready.sessionId,
        token: "0".repeat(64),
        clientAck: 0,
        serverAck: 0,
      }),
    );
    expect(await denied).toMatchObject({ type: "error", code: "expired" });
    expect(sockets[0].destroyed).toBe(false);

    try {
      await vi.advanceTimersByTimeAsync(120_000);
      expect(sockets[0].destroyed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
    await closeLocalRelay(wss);
    await new Promise<void>((resolve) => target.close(() => resolve()));
  });

  it("pauses v2 target reads at 256 KiB without losing buffered bytes", async () => {
    const payload = Buffer.alloc(300 * 1024, 7);
    const target = createServer((socket) => socket.write(payload));
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    const sockets: Socket[] = [];
    const wss = startLocalRelay({
      port: 0,
      maxGraceMs: 120_000,
      targetConnector: (options) => {
        const socket = netConnect(options);
        sockets.push(socket);
        return socket;
      },
    });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const client = await openRelayClient((wss.address() as AddressInfo).port);
    const frames: V2Frame[] = [];
    client.on("message", (data) => frames.push(decodeV2Frame(data.toString())));
    client.send(
      encodeV2Frame({
        version: 2,
        type: "connect",
        host: "127.0.0.1",
        port: (target.address() as AddressInfo).port,
        requestedGraceMs: 120000,
      }),
    );
    await vi.waitFor(() => expect(sockets[0]?.isPaused()).toBe(true));
    expect(
      frames
        .filter((frame) => frame.type === "data")
        .reduce((sum, frame) => sum + (frame.type === "data" ? frame.payload.length : 0), 0),
    ).toBe(256 * 1024);
    await closeLocalRelay(wss);
    await new Promise<void>((resolve) => target.close(() => resolve()));
  });

  it("revokes a v2 session when its target closes", async () => {
    let targetSocket: Socket | undefined;
    const target = createServer((socket) => {
      targetSocket = socket;
    });
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    const wss = startLocalRelay({ port: 0, maxGraceMs: 120_000 });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const port = (wss.address() as AddressInfo).port;
    const client = await openRelayClient(port);
    const readyFrame = nextV2Frame(client);
    client.send(
      encodeV2Frame({
        version: 2,
        type: "connect",
        host: "127.0.0.1",
        port: (target.address() as AddressInfo).port,
        requestedGraceMs: 120000,
      }),
    );
    const ready = await readyFrame;
    if (ready.type !== "ready") throw new Error("expected ready");
    const closed = new Promise<void>((resolve) => client.once("close", () => resolve()));
    targetSocket!.destroy();
    await closed;
    const resume = await openRelayClient(port);
    const denied = nextV2Frame(resume);
    resume.send(
      encodeV2Frame({
        version: 2,
        type: "resume",
        sessionId: ready.sessionId,
        token: ready.token,
        clientAck: 0,
        serverAck: 0,
      }),
    );
    expect(await denied).toMatchObject({ type: "error", code: "expired" });
    await closeLocalRelay(wss);
    await new Promise<void>((resolve) => target.close(() => resolve()));
  });

  it("ignores data queued after a v2 detach frame", async () => {
    const received: Buffer[] = [];
    const target = createServer((socket) => socket.on("data", (chunk) => received.push(chunk)));
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    const wss = startLocalRelay({ port: 0, maxGraceMs: 120_000 });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const client = await openRelayClient((wss.address() as AddressInfo).port);
    const readyFrame = nextV2Frame(client);
    client.send(
      encodeV2Frame({
        version: 2,
        type: "connect",
        host: "127.0.0.1",
        port: (target.address() as AddressInfo).port,
        requestedGraceMs: 120000,
      }),
    );
    expect((await readyFrame).type).toBe("ready");
    client.send(encodeV2Frame({ version: 2, type: "detach" }));
    client.send(
      encodeV2Frame({
        version: 2,
        type: "data",
        direction: "client",
        offset: 0,
        payload: Buffer.from("late"),
      }),
    );
    await new Promise<void>((resolve) => client.once("close", resolve));
    expect(Buffer.concat(received).toString()).toBe("");
    await closeLocalRelay(wss);
    await new Promise<void>((resolve) => target.close(() => resolve()));
  });

  it("revokes v2 input when unacknowledged writes exceed 256 KiB", async () => {
    const socket = new Socket();
    socket.write = (() => true) as typeof socket.write;
    const wss = startLocalRelay({
      port: 0,
      maxGraceMs: 120_000,
      targetConnector: () => {
        queueMicrotask(() => socket.emit("connect"));
        return socket;
      },
    });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const client = await openRelayClient((wss.address() as AddressInfo).port);
    const readyFrame = nextV2Frame(client);
    client.send(
      encodeV2Frame({
        version: 2,
        type: "connect",
        host: "127.0.0.1",
        port: 22,
        requestedGraceMs: 120000,
      }),
    );
    expect((await readyFrame).type).toBe("ready");
    const errorFrame = nextV2Frame(client);
    client.send(
      encodeV2Frame({
        version: 2,
        type: "data",
        direction: "client",
        offset: 0,
        payload: Buffer.alloc(200 * 1024),
      }),
    );
    client.send(
      encodeV2Frame({
        version: 2,
        type: "data",
        direction: "client",
        offset: 200 * 1024,
        payload: Buffer.alloc(100 * 1024),
      }),
    );
    expect(await errorFrame).toMatchObject({ type: "error", code: "retention_exceeded" });
    expect(socket.destroyed).toBe(true);
    await closeLocalRelay(wss);
  });

  it("expires the oldest detached session when retained data exceeds 16 MiB", async () => {
    const target = createServer((socket) => socket.write(Buffer.alloc(256 * 1024, 3)));
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    const sockets: Socket[] = [];
    const wss = startLocalRelay({
      port: 0,
      maxGraceMs: 120_000,
      maxSessions: 65,
      targetConnector: (options) => {
        const socket = netConnect(options);
        sockets.push(socket);
        return socket;
      },
    });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const port = (wss.address() as AddressInfo).port;
    for (let index = 0; index < 65; index++) {
      const client = await openRelayClient(port);
      const readyFrame = nextV2Frame(client);
      client.send(
        encodeV2Frame({
          version: 2,
          type: "connect",
          host: "127.0.0.1",
          port: (target.address() as AddressInfo).port,
          requestedGraceMs: 120000,
        }),
      );
      expect((await readyFrame).type).toBe("ready");
      await vi.waitFor(() => expect(sockets[index]?.isPaused()).toBe(true));
      client.close();
      await new Promise<void>((resolve) => client.once("close", resolve));
    }
    await vi.waitFor(() => expect(sockets[0].destroyed).toBe(true));
    expect(sockets[1].destroyed).toBe(false);
    await closeLocalRelay(wss);
    expect(sockets.every((socket) => socket.destroyed)).toBe(true);
    await new Promise<void>((resolve) => target.close(() => resolve()));
  });
  it("rejects sessions above the configured limit and recovers capacity", async () => {
    const log = vi.fn();
    const wss = startLocalRelay({ port: 0, maxSessions: 1, log });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const relayPort = (wss.address() as AddressInfo).port;

    const first = new WebSocket(`ws://127.0.0.1:${relayPort}`);
    await new Promise<void>((resolve) => first.once("open", resolve));

    const second = new WebSocket(`ws://127.0.0.1:${relayPort}`);
    second.on("error", () => {});
    const status = await new Promise<number>((resolve) => {
      second.once("unexpected-response", (_request, response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
    });
    expect(status).toBe(503);
    expect(log.mock.calls.map(([line]) => String(line)).join("\n")).toContain(
      "relay session limit reached",
    );

    first.close();
    await new Promise<void>((resolve) => first.once("close", resolve));
    const replacement = new WebSocket(`ws://127.0.0.1:${relayPort}`);
    await new Promise<void>((resolve) => replacement.once("open", resolve));
    replacement.close();
    await closeLocalRelay(wss);
  });

  it("limits idle handshakes when session resume is enabled", async () => {
    const wss = startLocalRelay({ port: 0, maxSessions: 1, maxGraceMs: 120_000 });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const relayPort = (wss.address() as AddressInfo).port;
    const first = await openRelayClient(relayPort);
    const second = new WebSocket(`ws://127.0.0.1:${relayPort}`);
    second.on("error", () => {});
    try {
      const status = await new Promise<number>((resolve) => {
        second.once("open", () => resolve(101));
        second.once("unexpected-response", (_request, response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        });
      });
      expect(status).toBe(503);
      expect(wss.clients.size).toBe(1);
    } finally {
      if (second.readyState === WebSocket.OPEN) second.terminate();
      first.terminate();
      await closeLocalRelay(wss);
    }
  });

  it("closes an outbound connection that exceeds its deadline", async () => {
    const socket = new Socket();
    const wss = startLocalRelay({
      port: 0,
      targetConnectTimeoutMs: 10,
      targetConnector: () => socket,
    });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const relayPort = (wss.address() as AddressInfo).port;
    const client = new WebSocket(`ws://127.0.0.1:${relayPort}`);
    await new Promise<void>((resolve) => client.once("open", resolve));
    const closed = new Promise<number>((resolve) => client.once("close", resolve));
    client.send(encodeConnectFrame({ host: "127.0.0.1", port: 22 }));

    expect(await closed).toBe(1011);
    expect(socket.destroyed).toBe(true);
    await closeLocalRelay(wss);
  });

  // The engine maps these reasons to a recovery step, so each target failure
  // must keep a distinct, stable reason that never echoes the client's host.
  it.each([
    ["ENOTFOUND", "target host not found"],
    ["EAI_AGAIN", "target host not found"],
    ["ECONNREFUSED", "target connection refused"],
    ["ETIMEDOUT", "target connection timeout"],
    ["EHOSTUNREACH", "target host unreachable"],
    ["ENETUNREACH", "target host unreachable"],
    ["ECONNRESET", "target connection error"],
  ])("closes with a typed reason when the target fails with %s", async (code, reason) => {
    const socket = new Socket();
    const wss = startLocalRelay({ port: 0, targetConnector: () => socket });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const relayPort = (wss.address() as AddressInfo).port;
    const client = new WebSocket(`ws://127.0.0.1:${relayPort}`);
    await new Promise<void>((resolve) => client.once("open", resolve));
    const closed = new Promise<[number, string]>((resolve) =>
      client.once("close", (closeCode, closeReason) =>
        resolve([closeCode, closeReason.toString()]),
      ),
    );
    client.send(encodeConnectFrame({ host: "127.0.0.1", port: 22 }));
    await vi.waitFor(() => expect(socket.listenerCount("error")).toBeGreaterThan(0));
    socket.destroy(Object.assign(new Error("simulated"), { code }));

    expect(await closed).toEqual([1011, reason]);
    await closeLocalRelay(wss);
  });

  it("names a target deadline in the close reason", async () => {
    const socket = new Socket();
    const wss = startLocalRelay({
      port: 0,
      targetConnectTimeoutMs: 10,
      targetConnector: () => socket,
    });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const relayPort = (wss.address() as AddressInfo).port;
    const client = new WebSocket(`ws://127.0.0.1:${relayPort}`);
    await new Promise<void>((resolve) => client.once("open", resolve));
    const closed = new Promise<string>((resolve) =>
      client.once("close", (_code, reason) => resolve(reason.toString())),
    );
    client.send(encodeConnectFrame({ host: "127.0.0.1", port: 22 }));

    expect(await closed).toBe("target connection timeout");
    await closeLocalRelay(wss);
  });

  it("reports a refused target port through a real connection", async () => {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const closedPort = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const wss = startLocalRelay({ port: 0 });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const relayPort = (wss.address() as AddressInfo).port;
    const client = new WebSocket(`ws://127.0.0.1:${relayPort}`);
    await new Promise<void>((resolve) => client.once("open", resolve));
    const closed = new Promise<string>((resolve) =>
      client.once("close", (_code, reason) => resolve(reason.toString())),
    );
    client.send(encodeConnectFrame({ host: "127.0.0.1", port: closedPort }));

    expect(await closed).toBe("target connection refused");
    await closeLocalRelay(wss);
  });

  it("closes active clients during bounded shutdown", async () => {
    const wss = startLocalRelay({ port: 0 });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const relayPort = (wss.address() as AddressInfo).port;
    const client = new WebSocket(`ws://127.0.0.1:${relayPort}`);
    await new Promise<void>((resolve) => client.once("open", resolve));
    const closed = new Promise<number>((resolve) => client.once("close", resolve));

    await closeLocalRelay(wss, 50);

    expect(await closed).toBe(1001);
  });

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

  it.each([
    ["127.0.0.1:9080", "http://127.0.0.1:9080", [], true],
    ["[::1]:9080", "http://[::1]:9080", [], true],
    ["localhost:9080", "http://localhost:9080", [], true],
    ["server:9080", "http://server:9080", [], true],
    ["server.local:9080", "http://server.local:9080", [], true],
    ["server.lan:9080", "http://server.lan:9080", [], true],
    ["server.home.arpa:9080", "http://server.home.arpa:9080", [], true],
    ["server.internal:9080", "http://server.internal:9080", [], true],
    ["App.Example.Com:9080", "http://app.example.com:9080", ["APP.EXAMPLE.COM"], true],
    ["sub.app.example.com:9080", "http://sub.app.example.com:9080", ["app.example.com"], false],
    ["evil.example:9080", "http://evil.example:9080", [], false],
  ])(
    "checks same-origin Host %s against local or public names",
    async (host, origin, publicHosts, allowed) => {
      const log = vi.fn();
      const wss = startLocalRelay({
        port: 0,
        sameOrigin: true,
        publicHosts,
        log,
        accessConfig: parseAccessConfig({ ALLOWED_ORIGINS: "*", ALLOWED_HOSTS: "*" }),
      });
      await new Promise<void>((resolve) => wss.once("listening", resolve));
      const relayPort = (wss.address() as AddressInfo).port;
      const client = new WebSocket(`ws://127.0.0.1:${relayPort}`, {
        origin,
        headers: { Host: host },
      });
      client.on("error", () => {});
      if (allowed) {
        await new Promise<void>((resolve) => client.once("open", resolve));
        client.close();
        await new Promise<void>((resolve) => client.once("close", resolve));
      } else {
        const status = await new Promise<number>((resolve) =>
          client.once("unexpected-response", (_request, response) => {
            response.resume();
            resolve(response.statusCode ?? 0);
          }),
        );
        expect(status).toBe(403);
        expect(log.mock.calls.map(([line]) => String(line)).join("\n")).toContain(host);
      }
      await closeLocalRelay(wss);
    },
  );

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

  it("refuses a long disallowed host without exceeding the close reason limit", async () => {
    const wss = startLocalRelay({
      port: 0,
      log: () => {},
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
    const closed = new Promise<{ code: number; reason: string }>((resolve) =>
      client.once("close", (code, reason) => resolve({ code, reason: reason.toString() })),
    );
    // A valid host name may run to 253 characters, far past the 123 bytes a
    // WebSocket close reason can carry.
    client.send(encodeConnectFrame({ host: `${"a".repeat(240)}.example`, port: 22 }));

    const { code, reason } = await closed;
    expect(code).toBe(1008);
    expect(Buffer.byteLength(reason)).toBeLessThanOrEqual(123);
    await closeLocalRelay(wss);
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

  it("rejects a binary connect frame", async () => {
    const wss = startLocalRelay({ port: 0 });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const relayPort = (wss.address() as AddressInfo).port;

    const client = new WebSocket(`ws://127.0.0.1:${relayPort}`);
    await new Promise<void>((resolve) => client.once("open", resolve));
    const closed = new Promise<number>((resolve) => client.once("close", resolve));
    client.send(Buffer.from(encodeConnectFrame({ host: "127.0.0.1", port: 22 })));

    expect(await closed).toBe(1002);
    wss.close();
  });

  it("rejects a WebSocket message larger than the relay buffer limit", async () => {
    const wss = startLocalRelay({ port: 0 });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    const relayPort = (wss.address() as AddressInfo).port;

    const client = new WebSocket(`ws://127.0.0.1:${relayPort}`);
    await new Promise<void>((resolve) => client.once("open", resolve));
    const closed = new Promise<number>((resolve) => client.once("close", resolve));
    client.send(Buffer.alloc(1024 * 1024 + 1));

    expect(await closed).toBe(1009);
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

describe("local relay grant, cap and capacity", () => {
  const KIB = 1024;

  async function listenTarget(onSocket?: (socket: Socket) => void) {
    const server = createServer(onSocket);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return {
      port: (server.address() as AddressInfo).port,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  async function startRelay(options: Omit<Parameters<typeof startLocalRelay>[0], "port">) {
    const sockets: Socket[] = [];
    const wss = startLocalRelay({
      port: 0,
      targetConnector: (connectOptions) => {
        const socket = netConnect(connectOptions);
        sockets.push(socket);
        return socket;
      },
      ...options,
    });
    await new Promise<void>((resolve) => wss.once("listening", resolve));
    return { wss, sockets, port: (wss.address() as AddressInfo).port };
  }

  async function connectV2(port: number, targetPort: number, requestedGraceMs: number | null) {
    const client = await openRelayClient(port);
    const first = nextV2Frame(client);
    client.send(
      encodeV2Frame({
        version: 2,
        type: "connect",
        host: "127.0.0.1",
        port: targetPort,
        requestedGraceMs,
      }),
    );
    const ready = await first;
    if (ready.type !== "ready") throw new Error(`expected ready, got ${ready.type}`);
    return { client, ready };
  }

  async function detach(client: WebSocket) {
    const closed = new Promise<void>((resolve) => client.once("close", () => resolve()));
    client.send(encodeV2Frame({ version: 2, type: "detach" }));
    await closed;
  }

  it("grants min(requested, cap) for every keep-alive choice", async () => {
    const target = await listenTarget();
    const choices = [120_000, 300_000, 600_000, 900_000, 3_600_000, null];
    for (const cap of [300_000, 3_600_000, null]) {
      const relay = await startRelay({ maxGraceMs: cap });
      for (const requested of choices) {
        const { client, ready } = await connectV2(relay.port, target.port, requested);
        const expected =
          requested === null ? cap : cap === null ? requested : Math.min(requested, cap);
        expect(ready, `requested ${requested}, cap ${cap}`).toMatchObject({
          grantedGraceMs: expected,
          capGraceMs: cap,
        });
        client.send(encodeV2Frame({ version: 2, type: "close" }));
      }
      await closeLocalRelay(relay.wss);
    }
    await target.close();
  });

  it("answers resume_disabled to v2 frames when the cap is 0", async () => {
    const target = await listenTarget();
    for (const options of [{}, { maxGraceMs: 0 }]) {
      const relay = await startRelay(options);
      const client = await openRelayClient(relay.port);
      const answer = nextV2Frame(client);
      const closed = new Promise<void>((resolve) => client.once("close", () => resolve()));
      client.send(
        encodeV2Frame({
          version: 2,
          type: "connect",
          host: "127.0.0.1",
          port: target.port,
          requestedGraceMs: 120_000,
        }),
      );
      expect(await answer).toEqual({ version: 2, type: "error", code: "resume_disabled" });
      await closed;
      const resumer = await openRelayClient(relay.port);
      const resumeAnswer = nextV2Frame(resumer);
      resumer.send(
        encodeV2Frame({
          version: 2,
          type: "resume",
          sessionId: "0".repeat(32),
          token: "0".repeat(64),
          clientAck: 0,
          serverAck: 0,
        }),
      );
      expect(await resumeAnswer).toEqual({ version: 2, type: "error", code: "resume_disabled" });
      expect(relay.sockets).toHaveLength(0);
      await closeLocalRelay(relay.wss);
    }
    await target.close();
  });

  it("rejects an invalid maxGraceMs", () => {
    for (const maxGraceMs of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => startLocalRelay({ port: 0, maxGraceMs })).toThrow(/maxGraceMs/);
    }
  });

  it("keeps a 30-day grant past the Node timer clamp and expires it on time", async () => {
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const target = await listenTarget();
    const relay = await startRelay({ maxGraceMs: null });
    const { client, ready } = await connectV2(relay.port, target.port, thirtyDays);
    expect(ready.grantedGraceMs).toBe(thirtyDays);
    vi.useFakeTimers();
    try {
      await detach(client);
      await vi.advanceTimersByTimeAsync(1);
      expect(relay.sockets[0].destroyed).toBe(false);
      await vi.advanceTimersByTimeAsync(thirtyDays - 2);
      expect(relay.sockets[0].destroyed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(relay.sockets[0].destroyed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
    await closeLocalRelay(relay.wss);
    await target.close();
  });

  it("keeps an unlimited session for 10 hours until capacity pressure or shutdown", async () => {
    const target = await listenTarget();
    const relay = await startRelay({ maxGraceMs: null, maxSessions: 2 });
    const first = await connectV2(relay.port, target.port, null);
    const second = await connectV2(relay.port, target.port, null);
    expect(first.ready).toMatchObject({ grantedGraceMs: null, capGraceMs: null });
    vi.useFakeTimers();
    try {
      await detach(first.client);
      await detach(second.client);
      await vi.advanceTimersByTimeAsync(10 * 60 * 60 * 1000);
      expect(relay.sockets[0].destroyed).toBe(false);
      expect(relay.sockets[1].destroyed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
    await connectV2(relay.port, target.port, null);
    expect(relay.sockets[0].destroyed).toBe(true);
    expect(relay.sockets[1].destroyed).toBe(false);
    await closeLocalRelay(relay.wss);
    expect(relay.sockets.every((socket) => socket.destroyed)).toBe(true);
    await target.close();
  });

  it("evicts the oldest detached session for v1 and v2 connects and refuses when all are attached", async () => {
    const target = await listenTarget();
    const relay = await startRelay({ maxGraceMs: 120_000, maxSessions: 2 });
    const a = await connectV2(relay.port, target.port, 120_000);
    await detach(a.client);
    const b = await connectV2(relay.port, target.port, 120_000);

    const v1 = await openRelayClient(relay.port);
    v1.send(encodeConnectFrame({ host: "127.0.0.1", port: target.port }));
    await vi.waitFor(() => expect(relay.sockets[2]?.connecting).toBe(false));
    expect(relay.sockets[0].destroyed).toBe(true);
    expect(relay.sockets[1].destroyed).toBe(false);
    expect(relay.sockets[2].destroyed).toBe(false);
    const evicted = await openRelayClient(relay.port);
    const evictedAnswer = nextV2Frame(evicted);
    evicted.send(
      encodeV2Frame({
        version: 2,
        type: "resume",
        sessionId: a.ready.sessionId,
        token: a.ready.token,
        clientAck: 0,
        serverAck: 0,
      }),
    );
    expect(await evictedAnswer).toMatchObject({ type: "error", code: "expired" });

    await detach(b.client);
    await connectV2(relay.port, target.port, 120_000);
    expect(relay.sockets[1].destroyed).toBe(true);
    expect(relay.sockets).toHaveLength(4);

    const refused = await openRelayClient(relay.port);
    const refusedClose = new Promise<number>((resolve) => refused.once("close", resolve));
    refused.send(encodeConnectFrame({ host: "127.0.0.1", port: target.port }));
    expect(await refusedClose).toBe(1013);
    const refusedV2 = await openRelayClient(relay.port);
    const refusedV2Close = new Promise<number>((resolve) => refusedV2.once("close", resolve));
    refusedV2.send(
      encodeV2Frame({
        version: 2,
        type: "connect",
        host: "127.0.0.1",
        port: target.port,
        requestedGraceMs: 120_000,
      }),
    );
    expect(await refusedV2Close).toBe(1013);
    expect(relay.sockets).toHaveLength(4);
    expect(relay.sockets[2].destroyed).toBe(false);
    expect(relay.sockets[3].destroyed).toBe(false);
    await closeLocalRelay(relay.wss);
    await target.close();
  });

  it("counts retained output, client history and pending input against the 16 MiB budget", async () => {
    // Each detached session holds 256 KiB in each buffer: 21 fit in 16 MiB, 22 do not.
    const target = await listenTarget((socket) => socket.write(Buffer.alloc(256 * KIB, 5)));
    const relay = await startRelay({ maxGraceMs: 120_000 });
    const input = Buffer.alloc(256 * KIB, 9);
    const park = async (index: number) => {
      const { client } = await connectV2(relay.port, target.port, 120_000);
      const socket = relay.sockets[index];
      // A write that never completes keeps the input pending on the target.
      socket.write = (() => true) as typeof socket.write;
      await vi.waitFor(() => expect(socket.isPaused()).toBe(true));
      client.send(
        encodeV2Frame({
          version: 2,
          type: "data",
          direction: "client",
          offset: 0,
          payload: input,
        }),
      );
      await detach(client);
    };
    for (let index = 0; index < 21; index++) await park(index);
    expect(relay.sockets.some((socket) => socket.destroyed)).toBe(false);
    await park(21);
    await vi.waitFor(() => expect(relay.sockets[0].destroyed).toBe(true));
    expect(relay.sockets.slice(1).some((socket) => socket.destroyed)).toBe(false);
    await closeLocalRelay(relay.wss);
    await target.close();
  });

  it("enables TCP keep-alive on v2 target sockets only", async () => {
    const target = await listenTarget();
    const keepAlive: ReturnType<typeof vi.fn>[] = [];
    const relay = await startRelay({
      maxGraceMs: 120_000,
      targetConnector: (connectOptions) => {
        const socket = netConnect(connectOptions);
        keepAlive.push(vi.spyOn(socket, "setKeepAlive") as unknown as ReturnType<typeof vi.fn>);
        return socket;
      },
    });
    await connectV2(relay.port, target.port, 120_000);
    expect(keepAlive[0]).toHaveBeenCalledWith(true, 60_000);
    const v1 = await openRelayClient(relay.port);
    v1.send(encodeConnectFrame({ host: "127.0.0.1", port: target.port }));
    await vi.waitFor(() => expect(keepAlive).toHaveLength(2));
    expect(keepAlive[1]).not.toHaveBeenCalled();
    await closeLocalRelay(relay.wss);
    await target.close();
  });

  describe("liveness, takeover, rotation and resume limit", () => {
    async function resumeWith(port: number, sessionId: string, token: string, serverAck = 0) {
      const client = await openRelayClient(port);
      const closed = new Promise<number>((resolve) =>
        client.once("close", (code) => resolve(code)),
      );
      const frames: V2Frame[] = [];
      client.on("message", (data) => frames.push(decodeV2Frame(data.toString())));
      const answer = nextV2Frame(client);
      client.send(
        encodeV2Frame({ version: 2, type: "resume", sessionId, token, clientAck: 0, serverAck }),
      );
      return { client, answer, closed, frames };
    }

    async function resumedToken(port: number, sessionId: string, token: string): Promise<string> {
      const { answer } = await resumeWith(port, sessionId, token);
      const frame = await answer;
      if (frame.type !== "resumed") throw new Error(`expected resumed, got ${frame.type}`);
      return frame.newToken;
    }

    it("detaches an attached socket after 90 s of client silence", async () => {
      const target = await listenTarget();
      const relay = await startRelay({ maxGraceMs: 120_000 });
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      try {
        const { client } = await connectV2(relay.port, target.port, 5_000);
        await vi.advanceTimersByTimeAsync(89_999);
        expect(client.readyState).toBe(WebSocket.OPEN);
        await vi.advanceTimersByTimeAsync(1);
        expect(client.readyState).not.toBe(WebSocket.OPEN);
        // Detaching starts the 5 s grace; the target outlives the socket by exactly that.
        await vi.advanceTimersByTimeAsync(4_999);
        expect(relay.sockets[0].destroyed).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(relay.sockets[0].destroyed).toBe(true);
      } finally {
        vi.useRealTimers();
      }
      await closeLocalRelay(relay.wss);
      await target.close();
    });

    it("resets the silence timer on data, ack and ping frames", async () => {
      // Drain what the relay forwards, or the target never sees end and close hangs.
      const target = await listenTarget((socket) => socket.resume());
      const relay = await startRelay({ maxGraceMs: 120_000 });
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      try {
        const { client } = await connectV2(relay.port, target.port, 5_000);
        const frames: V2Frame[] = [];
        client.on("message", (data) => frames.push(decodeV2Frame(data.toString())));
        // The relay's own listener runs first, so this count means it has
        // handled the frame before fake time moves on.
        let handled = 0;
        for (const serverSide of relay.wss.clients) serverSide.on("message", () => (handled += 1));
        const resets: V2Frame[] = [
          {
            version: 2,
            type: "data",
            direction: "client",
            offset: 0,
            payload: new Uint8Array([1]),
          },
          { version: 2, type: "ack", direction: "server", offset: 0 },
          { version: 2, type: "ping" },
        ];
        for (const [index, frame] of resets.entries()) {
          await vi.advanceTimersByTimeAsync(60_000);
          expect(client.readyState, frame.type).toBe(WebSocket.OPEN);
          client.send(encodeV2Frame(frame));
          // Poll on real immediates: vi.waitFor would move fake time.
          while (handled < index + 1) await new Promise((resolve) => setImmediate(resolve));
        }
        await vi.advanceTimersByTimeAsync(89_999);
        expect(client.readyState).toBe(WebSocket.OPEN);
        await vi.advanceTimersByTimeAsync(1);
        expect(client.readyState).not.toBe(WebSocket.OPEN);
        expect(frames.map((frame) => frame.type)).toEqual(["ack", "pong"]);
        await vi.advanceTimersByTimeAsync(4_999);
        expect(relay.sockets[0].destroyed).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(relay.sockets[0].destroyed).toBe(true);
      } finally {
        vi.useRealTimers();
      }
      await closeLocalRelay(relay.wss);
      await target.close();
    });

    it("supersedes a still-attached socket on resume with the current token", async () => {
      const target = await listenTarget();
      const log = vi.fn();
      const relay = await startRelay({ maxGraceMs: 120_000, log });
      const old = await connectV2(relay.port, target.port, 120_000);
      const oldFrame = nextV2Frame(old.client);
      const oldClosed = new Promise<void>((resolve) => old.client.once("close", () => resolve()));
      const fresh = await resumeWith(relay.port, old.ready.sessionId, old.ready.token);
      expect(await fresh.answer).toMatchObject({ type: "resumed" });
      expect(await oldFrame).toEqual({ version: 2, type: "error", code: "superseded" });
      await oldClosed;
      expect(relay.sockets).toHaveLength(1);
      expect(relay.sockets[0].destroyed).toBe(false);
      await vi.waitFor(() => expect(relay.wss.clients.size).toBe(1));
      const pong = nextV2Frame(fresh.client);
      fresh.client.send(encodeV2Frame({ version: 2, type: "ping" }));
      expect(await pong).toEqual({ version: 2, type: "pong" });
      expect(log.mock.calls.flat().join("\n")).not.toContain(old.ready.token);
      await closeLocalRelay(relay.wss);
      await target.close();
    });

    it("rotates the token and keeps the previous one only until the first frame", async () => {
      const target = await listenTarget();
      const log = vi.fn();
      const relay = await startRelay({ maxGraceMs: 120_000, log });
      const { client, ready } = await connectV2(relay.port, target.port, 120_000);
      await detach(client);
      const seen = [ready.token];

      // The page never receives this resumed frame and sends nothing.
      const lost = await resumeWith(relay.port, ready.sessionId, ready.token);
      const lostFrame = await lost.answer;
      if (lostFrame.type !== "resumed") throw new Error("expected resumed");
      expect(lostFrame.newToken).toMatch(/^[0-9a-f]{64}$/);
      expect(lostFrame.newToken).not.toBe(ready.token);
      seen.push(lostFrame.newToken);
      lost.client.terminate();
      await lost.closed;

      const retry = await resumeWith(relay.port, ready.sessionId, ready.token);
      const retryFrame = await retry.answer;
      if (retryFrame.type !== "resumed") throw new Error("expected resumed");
      seen.push(retryFrame.newToken);
      expect(new Set(seen).size).toBe(3);
      const pong = nextV2Frame(retry.client);
      retry.client.send(encodeV2Frame({ version: 2, type: "ping" }));
      await pong;
      await detach(retry.client);

      for (const stale of [ready.token, lostFrame.newToken]) {
        const denied = await resumeWith(relay.port, ready.sessionId, stale);
        expect(await denied.answer).toMatchObject({ type: "error", code: "expired" });
      }
      await resumedToken(relay.port, ready.sessionId, retryFrame.newToken);
      expect(relay.sockets[0].destroyed).toBe(false);
      const logged = log.mock.calls.flat().join("\n");
      for (const token of seen) expect(logged).not.toContain(token);
      await closeLocalRelay(relay.wss);
      await target.close();
    });

    it("closes the 21st failed resume in a minute before session lookup", async () => {
      const target = await listenTarget();
      const log = vi.fn();
      const relay = await startRelay({ maxGraceMs: 120_000, log });
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      try {
        const { client, ready } = await connectV2(relay.port, target.port, 120_000);
        await detach(client);
        for (let i = 0; i < 20; i += 1) {
          const bad = await resumeWith(relay.port, ready.sessionId, "0".repeat(64));
          expect(await bad.answer).toMatchObject({ type: "error", code: "expired" });
        }
        // A valid token is refused too: the limit applies before lookup.
        const limited = await resumeWith(relay.port, ready.sessionId, ready.token);
        expect(await limited.closed).toBe(1008);
        expect(limited.frames).toEqual([]);
        expect(relay.sockets[0].destroyed).toBe(false);

        await vi.advanceTimersByTimeAsync(60_000);
        await resumedToken(relay.port, ready.sessionId, ready.token);
        const logged = log.mock.calls.flat().join("\n");
        expect(logged).toContain("too many failed resumes");
        expect(logged).not.toContain(ready.token);
      } finally {
        vi.useRealTimers();
      }
      await closeLocalRelay(relay.wss);
      await target.close();
    });
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
