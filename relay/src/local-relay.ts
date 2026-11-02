import { WebSocketServer, type WebSocket } from "ws";
import { createConnection, isIP, type Socket } from "node:net";
import { randomBytes } from "node:crypto";
import {
  createServer as createHttpServer,
  STATUS_CODES,
  type IncomingMessage,
  type Server as HttpServer,
} from "node:http";
import type { Server as HttpsServer } from "node:https";
import {
  AccessDeniedError,
  assertOriginAllowed,
  assertTargetAllowed,
  type RelayAccessConfig,
} from "./access.js";
import { handleCapabilities } from "./capabilities.js";
import { decodeConnectFrame, decodeV2Frame, encodeV2Frame, type V2Frame } from "./protocol.js";

// A client that opens the socket and never sends its connect frame would
// otherwise hold the socket and its target open indefinitely.
const CONNECT_FRAME_TIMEOUT_MS = 10_000;

// Pause the target once this much data is queued for a slow client, and
// resume once it has drained back to the lower mark. The gap between the two
// stops the socket flapping between paused and resumed on every chunk.
const PAUSE_WATERMARK_BYTES = 1024 * 1024;
const RESUME_WATERMARK_BYTES = 256 * 1024;
const MAX_WEBSOCKET_MESSAGE_BYTES = 1024 * 1024;
const MAX_SESSIONS = 256;
const TARGET_CONNECT_TIMEOUT_MS = 10_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;
// Node clamps a setTimeout delay above this to 1 ms, so longer grants are
// armed in chunks of at most this length.
const MAX_TIMER_MS = 2 ** 31 - 1;
// Long grace leaves the relay-to-server path idle; probe it so NAT and
// firewall state along the way does not expire.
const TARGET_KEEPALIVE_MS = 60_000;
const MAX_UNACKED_BYTES = 256 * 1024;
const MAX_DETACHED_BYTES = 16 * 1024 * 1024;
const MAX_V2_BUFFERED_BYTES = 128 * 1024;
const V2_SEND_CHUNK_BYTES = 32 * 1024;
// The page pings every 20 s. A suspended page can leave its socket open, so
// silence this long detaches the session and starts its grace.
const CLIENT_SILENCE_MS = 90_000;
// Failed resumes allowed per remote address per window. The 256-bit token
// makes guessing infeasible; the limit only curbs noise.
const MAX_RESUME_FAILURES = 20;
const RESUME_FAILURE_WINDOW_MS = 60_000;

interface RelaySession {
  id: string;
  token: string;
  /**
   * The token replaced by the last rotation. It stays valid until the first
   * client frame on the new attachment, in case the `resumed` frame was lost.
   */
  previousToken: string | null;
  origin: string | undefined;
  target: Socket;
  attached: WebSocket | null;
  /** Granted grace; null is unlimited. */
  graceMs: number | null;
  timer: NodeJS.Timeout | null;
  detachedAt: number;
  serverAck: number;
  serverOffset: number;
  clientOffset: number;
  clientAck: number;
  clientHistoryStart: number;
  clientHistory: Buffer;
  serverSent: number;
  pendingClientBytes: number;
  retained: Buffer[];
}

const relaySessions = new WeakMap<WebSocketServer, Map<string, RelaySession>>();
/** HTTP servers the relay created for itself, which closeLocalRelay must close. */
const ownedServers = new WeakMap<WebSocketServer, HttpServer>();

/**
 * The close reason for a target that failed before or during the session.
 * The browser engine maps these exact strings to a recovery step, so keep them
 * stable. They never include the client's host, which belongs in the log.
 */
function targetFailureReason(error: NodeJS.ErrnoException, timedOut: boolean): string {
  if (timedOut) return "target connection timeout";
  switch (error.code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "target host not found";
    case "ECONNREFUSED":
      return "target connection refused";
    case "ETIMEDOUT":
      return "target connection timeout";
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return "target host unreachable";
    default:
      return "target connection error";
  }
}

export interface LocalRelayOptions {
  port: number;
  server?: HttpServer | HttpsServer;
  path?: string;
  sameOrigin?: boolean;
  /** Public page hostnames permitted when sameOrigin is enabled. */
  publicHosts?: string[];
  /**
   * Interface to bind. Defaults to loopback: this relay dials arbitrary TCP
   * for whoever connects, so exposing it beyond the local machine turns it
   * into an open proxy for the whole network.
   */
  host?: string;
  /** Access policy. Omit only for the loopback development relay. */
  accessConfig?: RelayAccessConfig;
  /**
   * Where refused connections are reported. A browser cannot show its user why
   * a WebSocket handshake failed: the status code and body of a 403 are not
   * exposed to page scripts, so a misconfigured allowlist looks like a generic
   * connection failure. The server log is the only place the reason can be
   * read, so every refusal is written there with the value that was rejected.
   */
  log?: (message: string) => void;
  /** How long to wait for the connect frame before closing. */
  connectFrameTimeoutMs?: number;
  /** Buffered bytes for the client at which the target is paused. */
  pauseWatermarkBytes?: number;
  /** Buffered bytes at which a paused target is resumed. */
  resumeWatermarkBytes?: number;
  /** Maximum concurrent relay sessions. */
  maxSessions?: number;
  /** How long an outbound TCP connection may remain pending. */
  targetConnectTimeoutMs?: number;
  /** Test seam for outbound connections. */
  targetConnector?: typeof createConnection;
  /**
   * Longest detach grace a v2 session may be granted, in milliseconds. `0`
   * (the default) disables v2, so a v2 frame is answered with
   * `resume_disabled`. `null` means unlimited.
   */
  maxGraceMs?: number | null;
}

/** A browser always sends Origin; a non-browser client need not. */
function describeOrigin(origin: string | undefined | null): string {
  return origin && origin !== "" ? origin : "(no origin header)";
}

/**
 * Address to name in a log line. The relay usually sits behind the bundled nginx,
 * which makes every socket appear to come from the proxy, so the forwarded
 * address is preferred when present. A client can put anything in that header, so
 * this value is only ever written to the log; no access decision reads it.
 */
function describeClient(request: IncomingMessage): string {
  const forwarded = request.headers["x-forwarded-for"];
  const claimed = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  if (claimed) return claimed;
  return request.socket.remoteAddress ?? "unknown address";
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function isAllowedPageHost(hostHeader: string | undefined, publicHosts: string[]): boolean {
  if (!hostHeader) return false;
  const hostname = new URL(`http://${hostHeader}`).hostname.toLowerCase();
  const ip = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
  return (
    isIP(ip) !== 0 ||
    hostname === "localhost" ||
    (!hostname.includes(".") && hostname !== "") ||
    [".local", ".lan", ".home.arpa", ".internal"].some((suffix) => hostname.endsWith(suffix)) ||
    publicHosts.some((host) => host.trim().toLowerCase() === hostname)
  );
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

export function startLocalRelay({
  port,
  server,
  path,
  sameOrigin = false,
  publicHosts = [],
  host = "127.0.0.1",
  accessConfig,
  connectFrameTimeoutMs = CONNECT_FRAME_TIMEOUT_MS,
  pauseWatermarkBytes = PAUSE_WATERMARK_BYTES,
  resumeWatermarkBytes = RESUME_WATERMARK_BYTES,
  maxSessions = MAX_SESSIONS,
  targetConnectTimeoutMs = TARGET_CONNECT_TIMEOUT_MS,
  targetConnector = createConnection,
  maxGraceMs = 0,
  log = (message) => console.warn(message),
}: LocalRelayOptions): WebSocketServer {
  if (!isLoopbackHost(host) && !accessConfig) {
    throw new Error("accessConfig is required when binding the relay beyond loopback");
  }
  assertPositiveInteger("connectFrameTimeoutMs", connectFrameTimeoutMs);
  assertPositiveInteger("pauseWatermarkBytes", pauseWatermarkBytes);
  assertPositiveInteger("resumeWatermarkBytes", resumeWatermarkBytes);
  assertPositiveInteger("maxSessions", maxSessions);
  assertPositiveInteger("targetConnectTimeoutMs", targetConnectTimeoutMs);
  if (maxGraceMs !== null && (!Number.isSafeInteger(maxGraceMs) || maxGraceMs < 0)) {
    throw new Error("maxGraceMs must be a non-negative integer or null");
  }
  const resumableSessions = maxGraceMs !== 0;
  if (resumeWatermarkBytes >= pauseWatermarkBytes) {
    throw new Error("resumeWatermarkBytes must be less than pauseWatermarkBytes");
  }

  const sessions = new Map<string, RelaySession>();
  const pendingHandshakes = new Set<WebSocket>();
  // Keyed on the socket address, never X-Forwarded-For, which any client can
  // set. Behind a proxy every client shares one address.
  // Each address gets a fixed window that opens at its first failure.
  const resumeFailures = new Map<string, number>();
  const recordResumeFailure = (address: string) => {
    const count = (resumeFailures.get(address) ?? 0) + 1;
    if (count === 1) {
      setTimeout(() => resumeFailures.delete(address), RESUME_FAILURE_WINDOW_MS).unref();
    }
    resumeFailures.set(address, count);
    if (count === MAX_RESUME_FAILURES) {
      log(`refusing resumes from ${address} for up to a minute: too many failed resumes`);
    }
  };
  let wss: WebSocketServer;
  const sendV2 = (ws: WebSocket, frame: V2Frame) => {
    if (ws.readyState === ws.OPEN) ws.send(encodeV2Frame(frame));
  };
  const revoke = (
    session: RelaySession,
    code: "expired" | "session_closed" | "retention_exceeded" | "offset_mismatch",
  ) => {
    if (!sessions.delete(session.id)) return;
    if (session.timer) clearTimeout(session.timer);
    session.target.destroy();
    if (session.attached) {
      sendV2(session.attached, { version: 2, type: "error", code });
      session.attached.close();
    }
    session.retained.length = 0;
  };
  const heldBytes = (session: RelaySession) =>
    session.retained.reduce((n, chunk) => n + chunk.length, 0) +
    session.clientHistory.length +
    session.pendingClientBytes;
  const detachedByAge = () =>
    [...sessions.values()]
      .filter((session) => !session.attached)
      .sort((a, b) => a.detachedAt - b.detachedAt);
  const enforceDetachedCap = () => {
    const detached = detachedByAge();
    let bytes = detached.reduce((total, session) => total + heldBytes(session), 0);
    while (bytes > MAX_DETACHED_BYTES && detached.length) {
      const oldest = detached.shift()!;
      bytes -= heldBytes(oldest);
      revoke(oldest, "retention_exceeded");
    }
  };
  /**
   * Admits a new connect (v1 or v2) against maxSessions, counting attached and
   * detached sessions. Detached sessions give way, oldest first: an orphan's
   * token lives only in a page that may be gone. Refuses only when evicting
   * every detached session would still not make room.
   */
  const admitConnect = (): boolean => {
    const detached = detachedByAge();
    const excess = wss.clients.size + detached.length - maxSessions;
    if (excess <= 0) return true;
    if (excess > detached.length) return false;
    for (const session of detached.slice(0, excess)) revoke(session, "retention_exceeded");
    return true;
  };
  const armExpiry = (session: RelaySession, remainingMs: number) => {
    const step = Math.min(remainingMs, MAX_TIMER_MS);
    session.timer = setTimeout(() => {
      if (remainingMs > step) armExpiry(session, remainingMs - step);
      else revoke(session, "expired");
    }, step);
    session.timer.unref();
  };
  const detach = (session: RelaySession) => {
    if (!sessions.has(session.id) || !session.attached) return;
    session.attached = null;
    session.detachedAt = Date.now();
    if (session.graceMs !== null) armExpiry(session, session.graceMs);
    enforceDetachedCap();
  };
  const acknowledgeServer = (session: RelaySession, offset: number) => {
    let acknowledged = offset - session.serverAck;
    while (acknowledged > 0 && session.retained.length) {
      const head = session.retained[0];
      if (head.length <= acknowledged) {
        session.retained.shift();
        acknowledged -= head.length;
      } else {
        session.retained[0] = head.subarray(acknowledged);
        acknowledged = 0;
      }
    }
    session.serverAck = offset;
    session.target.resume();
  };
  const flushServer = (session: RelaySession) => {
    const ws = session.attached;
    if (!ws || ws.readyState !== ws.OPEN) return;
    while (session.serverSent < session.serverOffset && ws.bufferedAmount < MAX_V2_BUFFERED_BYTES) {
      let skipped = session.serverSent - session.serverAck;
      for (const chunk of session.retained) {
        if (skipped >= chunk.length) {
          skipped -= chunk.length;
          continue;
        }
        const payload = chunk.subarray(skipped, skipped + V2_SEND_CHUNK_BYTES);
        const offset = session.serverSent;
        session.serverSent += payload.length;
        ws.send(
          encodeV2Frame({ version: 2, type: "data", direction: "server", offset, payload }),
          () => {
            if (session.attached === ws) flushServer(session);
          },
        );
        break;
      }
    }
  };
  const handleV2 = (ws: WebSocket, origin: string | undefined, address: string, frame: V2Frame) => {
    if (frame.type === "resume") {
      if ((resumeFailures.get(address) ?? 0) >= MAX_RESUME_FAILURES) {
        ws.close(1008, "too many failed resumes");
        return;
      }
      const session = sessions.get(frame.sessionId);
      if (
        !session ||
        (session.token !== frame.token && session.previousToken !== frame.token) ||
        session.origin !== origin
      ) {
        recordResumeFailure(address);
        sendV2(ws, { version: 2, type: "error", code: "expired" });
        ws.close();
        return;
      }
      if (
        frame.clientAck > session.clientAck ||
        frame.serverAck < session.serverAck ||
        frame.serverAck > session.serverSent
      ) {
        sendV2(ws, { version: 2, type: "error", code: "offset_mismatch" });
        revoke(session, "session_closed");
        ws.close();
        return;
      }
      // Takeover: the holder of a valid token replaces a socket the relay has
      // not yet noticed is dead. Exactly one attachment remains.
      const superseded = session.attached;
      if (superseded) {
        session.attached = null;
        sendV2(superseded, { version: 2, type: "error", code: "superseded" });
        superseded.close();
      }
      acknowledgeServer(session, frame.serverAck);
      if (session.timer) clearTimeout(session.timer);
      session.timer = null;
      session.attached = ws;
      session.serverSent = session.serverAck;
      // A retry with the previous token means the page never saw the last
      // rotation, so the previous token stays and only the current one is
      // replaced.
      if (frame.token === session.token) session.previousToken = session.token;
      session.token = randomBytes(32).toString("hex");
      sendV2(ws, {
        version: 2,
        type: "resumed",
        clientAck: session.clientAck,
        serverAck: session.serverAck,
        newToken: session.token,
      });
      bindV2(ws, session);
      flushServer(session);
      return;
    }
    if (frame.type !== "connect") {
      ws.close(1002, "invalid connect frame");
      return;
    }
    try {
      if (accessConfig) assertTargetAllowed(frame.host, frame.port, accessConfig);
    } catch {
      ws.close(1008, "target not allowed");
      return;
    }
    if (!admitConnect()) {
      ws.close(1013, "relay session limit reached");
      return;
    }
    const target = targetConnector({ host: frame.host, port: frame.port });
    target.setKeepAlive(true, TARGET_KEEPALIVE_MS);
    const grant = Math.min(frame.requestedGraceMs ?? Infinity, maxGraceMs ?? Infinity);
    const graceMs = grant === Infinity ? null : grant;
    const session: RelaySession = {
      id: randomBytes(16).toString("hex"),
      token: randomBytes(32).toString("hex"),
      previousToken: null,
      origin,
      target,
      attached: ws,
      graceMs,
      timer: null,
      detachedAt: 0,
      serverAck: 0,
      serverOffset: 0,
      clientOffset: 0,
      clientAck: 0,
      clientHistoryStart: 0,
      clientHistory: Buffer.alloc(0),
      serverSent: 0,
      pendingClientBytes: 0,
      retained: [],
    };
    sessions.set(session.id, session);
    let timedOut = false;
    const connectTimer = setTimeout(() => {
      timedOut = true;
      target.destroy(new Error("target connection timeout"));
    }, targetConnectTimeoutMs);
    target.once("connect", () => {
      clearTimeout(connectTimer);
      sendV2(ws, {
        version: 2,
        type: "ready",
        sessionId: session.id,
        token: session.token,
        maxUnackedBytes: MAX_UNACKED_BYTES,
        grantedGraceMs: session.graceMs,
        capGraceMs: maxGraceMs,
      });
    });
    target.on("data", (chunk: Buffer) => {
      const retainedBytes = session.serverOffset - session.serverAck;
      const available = MAX_UNACKED_BYTES - retainedBytes;
      if (chunk.length > available) {
        target.pause();
        target.unshift(chunk.subarray(available));
        chunk = chunk.subarray(0, available);
      }
      if (chunk.length) {
        session.retained.push(chunk);
        session.serverOffset += chunk.length;
        flushServer(session);
      }
      if (session.serverOffset - session.serverAck >= MAX_UNACKED_BYTES) target.pause();
      enforceDetachedCap();
    });
    target.on("error", (error: NodeJS.ErrnoException) => {
      if (session.attached) session.attached.close(1011, targetFailureReason(error, timedOut));
      revoke(session, "session_closed");
    });
    target.on("close", () => {
      clearTimeout(connectTimer);
      revoke(session, "session_closed");
    });
    bindV2(ws, session);
  };
  const bindV2 = (ws: WebSocket, session: RelaySession) => {
    let silenceTimer: NodeJS.Timeout | null = null;
    const armSilence = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        if (session.attached === ws) detach(session);
        ws.terminate();
      }, CLIENT_SILENCE_MS);
      silenceTimer.unref();
    };
    armSilence();
    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (!sessions.has(session.id) || session.attached !== ws) return;
      armSilence();
      session.previousToken = null;
      let frame: V2Frame;
      try {
        if (isBinary) throw new Error("binary v2 frame");
        frame = decodeV2Frame(data.toString());
      } catch {
        revoke(session, "session_closed");
        return;
      }
      if (frame.type === "detach") {
        detach(session);
        ws.close();
      } else if (frame.type === "close") {
        revoke(session, "session_closed");
      } else if (frame.type === "ping") {
        sendV2(ws, { version: 2, type: "pong" });
      } else if (frame.type === "ack" && frame.direction === "server") {
        if (frame.offset < session.serverAck || frame.offset > session.serverSent) {
          revoke(session, "offset_mismatch");
          return;
        }
        acknowledgeServer(session, frame.offset);
        flushServer(session);
      } else if (frame.type === "data" && frame.direction === "client") {
        const overlap = Math.min(session.clientOffset - frame.offset, frame.payload.length);
        if (
          frame.offset > session.clientOffset ||
          frame.offset < session.clientHistoryStart ||
          (overlap > 0 &&
            !session.clientHistory
              .subarray(
                frame.offset - session.clientHistoryStart,
                frame.offset - session.clientHistoryStart + overlap,
              )
              .equals(Buffer.from(frame.payload.subarray(0, overlap))))
        ) {
          revoke(session, "offset_mismatch");
          return;
        }
        const payload = Buffer.from(frame.payload.subarray(Math.max(0, overlap)));
        if (session.pendingClientBytes + payload.length > MAX_UNACKED_BYTES) {
          revoke(session, "retention_exceeded");
          return;
        }
        if (!payload.length) {
          sendV2(ws, { version: 2, type: "ack", direction: "client", offset: session.clientAck });
          return;
        }
        session.clientHistory = Buffer.concat([session.clientHistory, payload]);
        if (session.clientHistory.length > MAX_UNACKED_BYTES) {
          const trim = session.clientHistory.length - MAX_UNACKED_BYTES;
          session.clientHistory = session.clientHistory.subarray(trim);
          session.clientHistoryStart += trim;
        }
        session.clientOffset += payload.length;
        const endOffset = session.clientOffset;
        session.pendingClientBytes += payload.length;
        if (
          !session.target.write(payload, (error?: Error | null) => {
            if (!sessions.has(session.id)) return;
            if (error) {
              revoke(session, "session_closed");
              return;
            }
            session.pendingClientBytes -= payload.length;
            session.clientAck = endOffset;
            if (session.attached)
              sendV2(session.attached, {
                version: 2,
                type: "ack",
                direction: "client",
                offset: endOffset,
              });
            if (session.attached === ws) ws.resume();
          })
        )
          ws.pause();
      } else {
        revoke(session, "session_closed");
      }
    });
    ws.on("close", () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      if (session.attached === ws) detach(session);
    });
  };
  // Without a host server the relay needs its own HTTP server, so that it can
  // answer the capability request as well as WebSocket upgrades.
  const ownServer = server
    ? undefined
    : createHttpServer((request, response) => {
        if (handleCapabilities(request, response, { maxGraceMs, accessConfig, sameOrigin })) {
          return;
        }
        const body = STATUS_CODES[426] ?? "Upgrade Required";
        response.writeHead(426, {
          "Content-Length": Buffer.byteLength(body),
          "Content-Type": "text/plain",
        });
        response.end(body);
      });
  wss = new WebSocketServer({
    server: server ?? ownServer,
    path,
    maxPayload: MAX_WEBSOCKET_MESSAGE_BYTES,
    verifyClient: (info, done) => {
      if (pendingHandshakes.size >= maxSessions) {
        log(`refused handshake from ${describeClient(info.req)}: relay session limit reached`);
        done(false, 503, "relay session limit reached");
        return;
      }
      if (!accessConfig) {
        done(true);
        return;
      }
      try {
        if (sameOrigin) {
          if (new URL(info.origin).host.toLowerCase() !== info.req.headers.host?.toLowerCase()) {
            throw new AccessDeniedError("origin does not match this server");
          }
          if (!isAllowedPageHost(info.req.headers.host, publicHosts)) {
            throw new AccessDeniedError(`server hostname not allowed: ${info.req.headers.host}`);
          }
        }
        assertOriginAllowed(info.origin, accessConfig);
        done(true);
      } catch (error) {
        const message = error instanceof AccessDeniedError ? error.message : "relay access denied";
        const from = describeClient(info.req);
        log(
          `refused handshake from ${from}: ${message}. ` +
            `Add the exact page origin ${describeOrigin(info.origin)} to ALLOWED_ORIGINS, ` +
            "or add a public page hostname to PUBLIC_HOSTS in same-origin mode.",
        );
        done(false, 403, message);
      }
    },
  });
  relaySessions.set(wss, sessions);
  if (ownServer) {
    ownedServers.set(wss, ownServer);
    ownServer.listen(port, host);
  }

  wss.on("connection", (ws: WebSocket, request: IncomingMessage) => {
    pendingHandshakes.add(ws);
    let target: Socket | null = null;
    const origin = describeOrigin(request.headers.origin);

    // `ws` emits 'error' on the socket for ordinary client faults, including a
    // malformed frame from any client that can reach the port. Node raises
    // ERR_UNHANDLED_ERROR when an EventEmitter emits 'error' with no listener,
    // which would take down the relay process and every other session with it.
    ws.on("error", () => {
      target?.destroy();
      ws.terminate();
    });

    const frameTimer = setTimeout(() => {
      ws.close(1002, "connect frame timeout");
    }, connectFrameTimeoutMs);

    ws.once("message", (data: Buffer, isBinary: boolean) => {
      clearTimeout(frameTimer);
      pendingHandshakes.delete(ws);
      if (isBinary) {
        ws.close(1002, "connect frame must be text");
        return;
      }

      if (data.toString().startsWith("[2,")) {
        let v2Frame: V2Frame;
        try {
          v2Frame = decodeV2Frame(data.toString());
        } catch {
          ws.close(1002, "invalid connect frame");
          return;
        }
        if (!resumableSessions) {
          sendV2(ws, { version: 2, type: "error", code: "resume_disabled" });
          ws.close();
          return;
        }
        handleV2(ws, request.headers.origin, request.socket.remoteAddress ?? "unknown", v2Frame);
        return;
      }

      let frame;
      try {
        frame = decodeConnectFrame(data.toString());
      } catch {
        ws.close(1002, "invalid connect frame");
        return;
      }

      try {
        if (accessConfig) assertTargetAllowed(frame.host, frame.port, accessConfig);
      } catch (error) {
        const message = error instanceof AccessDeniedError ? error.message : "target not allowed";
        log(
          `refused target ${frame.host}:${frame.port} from ${origin}: ${message}. ` +
            "Add the host to ALLOWED_HOSTS and the port to ALLOWED_PORTS to permit it.",
        );
        // The detail, which echoes the client's host, stays in the log: a close
        // reason is limited to 123 bytes and ws throws past that, which a
        // 253-character host name would reach.
        ws.close(1008, "target not allowed");
        return;
      }

      if (!admitConnect()) {
        ws.close(1013, "relay session limit reached");
        return;
      }

      const socket = targetConnector({ host: frame.host, port: frame.port });
      target = socket;
      let timedOut = false;
      const connectTimer = setTimeout(() => {
        timedOut = true;
        socket.destroy(new Error("target connection timeout"));
      }, targetConnectTimeoutMs);
      socket.once("connect", () => clearTimeout(connectTimer));

      // Client to target. write() returning false means the kernel buffer is
      // full, so stop reading the WebSocket until the socket drains rather
      // than piling chunks up in memory.
      ws.on("message", (chunk: Buffer, isBinary: boolean) => {
        if (!isBinary) return;
        if (!socket.write(chunk)) ws.pause();
      });
      socket.on("drain", () => ws.resume());

      // Target to client. ws has no drain event, so throttle on its own
      // buffered byte count: pause the target once the socket has queued more
      // than the high-water mark and resume when it has flushed back down.
      socket.on("data", (chunk: Buffer) => {
        ws.send(chunk, () => {
          if (ws.bufferedAmount <= resumeWatermarkBytes) socket.resume();
        });
        if (ws.bufferedAmount > pauseWatermarkBytes) socket.pause();
      });

      socket.on("close", () => {
        clearTimeout(connectTimer);
        ws.close();
      });
      socket.on("error", (error: NodeJS.ErrnoException) =>
        ws.close(1011, targetFailureReason(error, timedOut)),
      );
    });

    ws.on("close", () => {
      pendingHandshakes.delete(ws);
      clearTimeout(frameTimer);
      target?.destroy();
    });
  });

  return wss;
}

export function closeLocalRelay(
  wss: WebSocketServer,
  timeoutMs = SHUTDOWN_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    for (const session of relaySessions.get(wss)?.values() ?? []) {
      session.target.destroy();
      if (session.timer) clearTimeout(session.timer);
    }
    relaySessions.get(wss)?.clear();
    const timer = setTimeout(() => {
      for (const client of wss.clients) client.terminate();
    }, timeoutMs);
    timer.unref();

    for (const client of wss.clients) client.close(1001, "relay shutting down");
    wss.close((error) => {
      clearTimeout(timer);
      if (error) {
        reject(error);
        return;
      }
      const own = ownedServers.get(wss);
      if (!own?.listening) {
        resolve();
        return;
      }
      own.close((closeError) => {
        if (closeError) reject(closeError);
        else resolve();
      });
    });
  });
}
