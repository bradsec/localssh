import type { IncomingMessage, ServerResponse } from "node:http";
import { AccessDeniedError, assertOriginAllowed, type RelayAccessConfig } from "./access.js";

export interface CapabilityPolicy {
  /** Longest grant a v2 session may receive. `0` disables v2; `null` is unlimited. */
  maxGraceMs: number | null;
  /** Omitted only by the loopback development relay, which accepts any origin. */
  accessConfig?: RelayAccessConfig;
  /** The page and relay share an origin, so no CORS header is needed. */
  sameOrigin: boolean;
}

/**
 * Answers `GET .../capabilities` so the page can learn, before it connects,
 * whether this relay resumes sessions and how long it holds them. The path may
 * carry a prefix because the standalone relay usually sits behind `/relay`.
 * Returns false when the request is for another path.
 */
export function handleCapabilities(
  request: IncomingMessage,
  response: ServerResponse,
  policy: CapabilityPolicy,
): boolean {
  let pathname: string;
  try {
    pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  } catch {
    return false;
  }
  if (pathname !== "/capabilities" && !pathname.endsWith("/capabilities")) return false;
  if (request.method !== "GET") {
    response.writeHead(405, { Allow: "GET" });
    response.end();
    return true;
  }
  const origin = request.headers.origin;
  if (!policy.sameOrigin && origin) {
    let allowed = true;
    if (policy.accessConfig) {
      try {
        assertOriginAllowed(origin, policy.accessConfig);
      } catch (error) {
        if (!(error instanceof AccessDeniedError)) throw error;
        // An unlisted origin gets the body without CORS, so its page cannot read it.
        allowed = false;
      }
    }
    if (allowed) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
    }
  }
  response.writeHead(200, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(
    JSON.stringify({
      protocols: [1, 2],
      resume: policy.maxGraceMs !== 0,
      maxGraceMs: policy.maxGraceMs,
    }),
  );
  return true;
}
