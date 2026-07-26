import { WebSocketServer, type WebSocket } from "ws";
import { createConnection, type Socket } from "node:net";
import type { IncomingMessage } from "node:http";
import {
  AccessDeniedError,
  assertOriginAllowed,
  assertTargetAllowed,
  type RelayAccessConfig,
} from "./access.js";
import { decodeConnectFrame } from "./protocol.js";

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

export interface LocalRelayOptions {
  port: number;
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

export function startLocalRelay({
  port,
  host = "127.0.0.1",
  accessConfig,
  connectFrameTimeoutMs = CONNECT_FRAME_TIMEOUT_MS,
  pauseWatermarkBytes = PAUSE_WATERMARK_BYTES,
  resumeWatermarkBytes = RESUME_WATERMARK_BYTES,
  maxSessions = MAX_SESSIONS,
  targetConnectTimeoutMs = TARGET_CONNECT_TIMEOUT_MS,
  targetConnector = createConnection,
  log = (message) => console.warn(message),
}: LocalRelayOptions): WebSocketServer {
  if (!Number.isInteger(maxSessions) || maxSessions < 1) {
    throw new Error("maxSessions must be a positive integer");
  }

  let wss: WebSocketServer;
  wss = new WebSocketServer({
    port,
    host,
    maxPayload: MAX_WEBSOCKET_MESSAGE_BYTES,
    verifyClient: (info, done) => {
      if (wss.clients.size >= maxSessions) {
        done(false, 503, "relay session limit reached");
        return;
      }
      if (!accessConfig) {
        done(true);
        return;
      }
      try {
        assertOriginAllowed(info.origin, accessConfig);
        done(true);
      } catch (error) {
        const message = error instanceof AccessDeniedError ? error.message : "relay access denied";
        const from = describeClient(info.req);
        log(
          `refused handshake from ${from}: ${message}. ` +
            `Add the exact page origin ${describeOrigin(info.origin)} to ALLOWED_ORIGINS, ` +
            "or set ALLOWED_ORIGINS=* for a firewalled local network.",
        );
        done(false, 403, message);
      }
    },
  });

  wss.on("connection", (ws: WebSocket, request: IncomingMessage) => {
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
      if (isBinary) {
        ws.close(1002, "connect frame must be text");
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
        ws.close(1008, message);
        return;
      }

      const socket = targetConnector({ host: frame.host, port: frame.port });
      target = socket;
      const connectTimer = setTimeout(() => {
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
      socket.on("error", () => ws.close(1011, "target connection error"));
    });

    ws.on("close", () => {
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
    const timer = setTimeout(() => {
      for (const client of wss.clients) client.terminate();
    }, timeoutMs);
    timer.unref();

    for (const client of wss.clients) client.close(1001, "relay shutting down");
    wss.close((error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    });
  });
}
