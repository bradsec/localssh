export interface ConnectFrame {
  host: string;
  port: number;
}

function isValidPort(port: unknown): port is number {
  return typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535;
}

export function encodeConnectFrame(frame: ConnectFrame): string {
  if (!frame.host || typeof frame.host !== "string") {
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
  if (typeof host !== "string" || host === "") {
    throw new Error("connect frame: missing or invalid host");
  }
  if (!isValidPort(port)) {
    throw new Error("connect frame: missing or invalid port");
  }

  return { host, port };
}
