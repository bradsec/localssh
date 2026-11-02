import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { handleCapabilities, type CapabilityPolicy } from "./capabilities.js";

const contentTypes: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const policy =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

export function createWebHandler(root: string, options: { capabilities?: CapabilityPolicy } = {}) {
  const base = resolve(root);
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader("Content-Security-Policy", policy);
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (request.url === "/healthz") {
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("ok\n");
      return;
    }
    if (options.capabilities && handleCapabilities(request, response, options.capabilities)) return;
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    } catch {
      response.writeHead(400);
      response.end();
      return;
    }
    const file = resolve(base, `.${pathname}`);
    if (file !== base && !file.startsWith(base + sep)) {
      response.writeHead(403);
      response.end();
      return;
    }
    let selected = file;
    try {
      if (!(await stat(selected)).isFile()) throw new Error("not a file");
    } catch {
      if (extname(pathname) || pathname.startsWith("/relay")) {
        response.writeHead(404);
        response.end();
        return;
      }
      selected = resolve(base, "index.html");
    }
    response.setHeader(
      "Content-Type",
      contentTypes[extname(selected)] ?? "application/octet-stream",
    );
    response.setHeader("Cache-Control", "no-cache");
    response.writeHead(200);
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(selected)
      .on("error", () => response.destroy())
      .pipe(response);
  };
}
