import { WebSocketServer, type WebSocket } from "ws";
import { createConnection, type Socket } from "node:net";
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
  /** How long to wait for the connect frame before closing. */
  connectFrameTimeoutMs?: number;
  /** Buffered bytes for the client at which the target is paused. */
  pauseWatermarkBytes?: number;
  /** Buffered bytes at which a paused target is resumed. */
  resumeWatermarkBytes?: number;
}

export function startLocalRelay({
  port,
  host = "127.0.0.1",
  accessConfig,
  connectFrameTimeoutMs = CONNECT_FRAME_TIMEOUT_MS,
  pauseWatermarkBytes = PAUSE_WATERMARK_BYTES,
  resumeWatermarkBytes = RESUME_WATERMARK_BYTES,
}: LocalRelayOptions): WebSocketServer {
  const wss = new WebSocketServer({
    port,
    host,
    verifyClient: accessConfig
      ? (info, done) => {
          try {
            assertOriginAllowed(info.origin, accessConfig);
            done(true);
          } catch (error) {
            const message =
              error instanceof AccessDeniedError ? error.message : "relay access denied";
            done(false, 403, message);
          }
        }
      : undefined,
  });

  wss.on("connection", (ws: WebSocket) => {
    let target: Socket | null = null;

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

    ws.once("message", (data: Buffer) => {
      clearTimeout(frameTimer);

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
        ws.close(1008, message);
        return;
      }

      const socket = createConnection({ host: frame.host, port: frame.port });
      target = socket;

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

      socket.on("close", () => ws.close());
      socket.on("error", () => ws.close(1011, "target connection error"));
    });

    ws.on("close", () => {
      clearTimeout(frameTimer);
      target?.destroy();
    });
  });

  return wss;
}
