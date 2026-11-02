export interface ConnectFrame {
  host: string;
  port: number;
}

function isValidPort(port: unknown): port is number {
  return typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535;
}

function isValidHost(host: unknown): host is string {
  if (typeof host !== "string" || host === "" || host.length > 253) return false;
  return !Array.from(host).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029 ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    );
  });
}

export function encodeConnectFrame(frame: ConnectFrame): string {
  if (!isValidHost(frame.host)) {
    throw new Error("connect frame: host must be a non-empty string");
  }
  if (!isValidPort(frame.port)) {
    throw new Error("connect frame: port must be an integer in 1..65535");
  }
  return JSON.stringify({ host: frame.host, port: frame.port });
}

export function decodeConnectFrame(raw: string): ConnectFrame {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("connect frame is not valid JSON");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("connect frame must be a JSON object");
  }

  const { host, port } = parsed as Record<string, unknown>;
  if (!isValidHost(host)) {
    throw new Error("connect frame: missing or invalid host");
  }
  if (!isValidPort(port)) {
    throw new Error("connect frame: missing or invalid port");
  }

  return { host, port };
}

export type V2Direction = "client" | "server";
export type V2ErrorCode =
  | "expired"
  | "offset_mismatch"
  | "invalid_frame"
  | "session_closed"
  | "retention_exceeded"
  | "resume_disabled"
  | "superseded";

/** Grace in milliseconds; `null` means unlimited (held until the page disconnects). */
export type V2GraceMs = number | null;

export type V2Frame =
  | { version: 2; type: "connect"; host: string; port: number; requestedGraceMs: V2GraceMs }
  | {
      version: 2;
      type: "ready";
      sessionId: string;
      token: string;
      maxUnackedBytes: number;
      grantedGraceMs: V2GraceMs;
      capGraceMs: V2GraceMs;
    }
  | {
      version: 2;
      type: "resume";
      sessionId: string;
      token: string;
      clientAck: number;
      serverAck: number;
    }
  | { version: 2; type: "resumed"; clientAck: number; serverAck: number; newToken: string }
  | { version: 2; type: "data"; direction: V2Direction; offset: number; payload: Uint8Array }
  | { version: 2; type: "ack"; direction: V2Direction; offset: number }
  | { version: 2; type: "detach" }
  | { version: 2; type: "close" }
  | { version: 2; type: "ping" }
  | { version: 2; type: "pong" }
  | { version: 2; type: "error"; code: V2ErrorCode };

const maxControlLength = 4096;
const maxDataBytes = 262144;
const maxDataLength = Math.ceil(maxDataBytes / 3) * 4 + 128;

function isOffset(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSessionId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
}

function isToken(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isGraceMs(value: unknown): value is V2GraceMs {
  return value === null || (isOffset(value) && value >= 1);
}

function isDirection(value: unknown): value is V2Direction {
  return value === "client" || value === "server";
}

function isErrorCode(value: unknown): value is V2ErrorCode {
  return (
    value === "expired" ||
    value === "offset_mismatch" ||
    value === "invalid_frame" ||
    value === "session_closed" ||
    value === "retention_exceeded" ||
    value === "resume_disabled" ||
    value === "superseded"
  );
}

function invalidV2Frame(): never {
  throw new Error("invalid v2 frame");
}

export function decodeV2Frame(raw: string): V2Frame {
  if (typeof raw !== "string" || raw.length > maxDataLength) invalidV2Frame();
  let parts: unknown;
  try {
    parts = JSON.parse(raw);
  } catch {
    invalidV2Frame();
  }
  if (!Array.isArray(parts) || parts[0] !== 2 || typeof parts[1] !== "string") invalidV2Frame();
  const [version, type, ...fields] = parts;
  if (type !== "data" && raw.length > maxControlLength) invalidV2Frame();
  switch (type) {
    case "connect": {
      const [host, port, requestedGraceMs] = fields;
      if (
        fields.length !== 3 ||
        !isValidHost(host) ||
        !isValidPort(port) ||
        !isGraceMs(requestedGraceMs)
      )
        invalidV2Frame();
      return { version, type, host, port, requestedGraceMs };
    }
    case "ready": {
      const [sessionId, token, maxUnackedBytes, grantedGraceMs, capGraceMs] = fields;
      if (
        fields.length !== 5 ||
        !isSessionId(sessionId) ||
        !isToken(token) ||
        !isOffset(maxUnackedBytes) ||
        maxUnackedBytes < 1 ||
        maxUnackedBytes > maxDataBytes ||
        !isGraceMs(grantedGraceMs) ||
        !isGraceMs(capGraceMs) ||
        (capGraceMs !== null && (grantedGraceMs === null || grantedGraceMs > capGraceMs))
      )
        invalidV2Frame();
      return { version, type, sessionId, token, maxUnackedBytes, grantedGraceMs, capGraceMs };
    }
    case "resume": {
      const [sessionId, token, clientAck, serverAck] = fields;
      if (
        fields.length !== 4 ||
        !isSessionId(sessionId) ||
        !isToken(token) ||
        !isOffset(clientAck) ||
        !isOffset(serverAck)
      )
        invalidV2Frame();
      return { version, type, sessionId, token, clientAck, serverAck };
    }
    case "resumed": {
      const [clientAck, serverAck, newToken] = fields;
      if (fields.length !== 3 || !isOffset(clientAck) || !isOffset(serverAck) || !isToken(newToken))
        invalidV2Frame();
      return { version, type, clientAck, serverAck, newToken };
    }
    case "data": {
      const [direction, offset, encoded] = fields;
      if (
        fields.length !== 3 ||
        !isDirection(direction) ||
        !isOffset(offset) ||
        typeof encoded !== "string" ||
        encoded.length === 0 ||
        encoded.length > Math.ceil(maxDataBytes / 3) * 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
      )
        invalidV2Frame();
      const payload = Buffer.from(encoded, "base64");
      if (
        payload.length === 0 ||
        payload.length > maxDataBytes ||
        payload.toString("base64") !== encoded ||
        !Number.isSafeInteger(offset + payload.length)
      )
        invalidV2Frame();
      return { version, type, direction, offset, payload: new Uint8Array(payload) };
    }
    case "ack": {
      const [direction, offset] = fields;
      if (fields.length !== 2 || !isDirection(direction) || !isOffset(offset)) invalidV2Frame();
      return { version, type, direction, offset };
    }
    case "detach":
    case "close":
    case "ping":
    case "pong":
      if (fields.length !== 0) invalidV2Frame();
      return { version, type };
    case "error": {
      const [code] = fields;
      if (fields.length !== 1 || !isErrorCode(code)) invalidV2Frame();
      return { version, type, code };
    }
    default:
      return invalidV2Frame();
  }
}

export function encodeV2Frame(frame: V2Frame): string {
  let fields: unknown[];
  switch (frame.type) {
    case "connect":
      fields = [frame.host, frame.port, frame.requestedGraceMs];
      break;
    case "ready":
      fields = [
        frame.sessionId,
        frame.token,
        frame.maxUnackedBytes,
        frame.grantedGraceMs,
        frame.capGraceMs,
      ];
      break;
    case "resume":
      fields = [frame.sessionId, frame.token, frame.clientAck, frame.serverAck];
      break;
    case "resumed":
      fields = [frame.clientAck, frame.serverAck, frame.newToken];
      break;
    case "data":
      if (!(frame.payload instanceof Uint8Array)) invalidV2Frame();
      fields = [frame.direction, frame.offset, Buffer.from(frame.payload).toString("base64")];
      break;
    case "ack":
      fields = [frame.direction, frame.offset];
      break;
    case "detach":
    case "close":
    case "ping":
    case "pong":
      fields = [];
      break;
    case "error":
      fields = [frame.code];
      break;
    default:
      return invalidV2Frame();
  }
  const raw = JSON.stringify([frame.version, frame.type, ...fields]);
  decodeV2Frame(raw);
  return raw;
}
