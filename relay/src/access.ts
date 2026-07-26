// Access control for the relay.
//
// The relay dials arbitrary TCP on behalf of whoever connects to it. Without a
// gate, a deployed relay is an anonymous open proxy: anyone who learns the URL
// can reach any host:port through it, and the traffic is attributable to
// whoever owns the deployment. Both checks below therefore default to deny.

export interface RelayAccessConfig {
  /** Exact `scheme://host[:port]` origins allowed to open a relay session. */
  allowedOrigins: string[];
  /** Hostnames the relay may dial. A leading "*." matches subdomains. */
  allowedHosts: string[];
  /** Ports the relay may dial. Empty means "22 only". */
  allowedPorts: number[];
}

export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessDeniedError";
  }
}

function splitList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

export function parseAccessConfig(env: Record<string, unknown>): RelayAccessConfig {
  const ports = splitList(env.ALLOWED_PORTS as string | undefined).map(Number);
  for (const port of ports) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new AccessDeniedError("ALLOWED_PORTS must be integers in 1..65535");
    }
  }

  return {
    allowedOrigins: splitList(env.ALLOWED_ORIGINS as string | undefined),
    allowedHosts: splitList(env.ALLOWED_HOSTS as string | undefined).map((host) =>
      host.toLowerCase(),
    ),
    allowedPorts: ports.length > 0 ? ports : [22],
  };
}

export function assertOriginAllowed(origin: string | null, config: RelayAccessConfig): void {
  if (config.allowedOrigins.length === 0) {
    throw new AccessDeniedError("relay is not configured: set ALLOWED_ORIGINS before deploying");
  }
  if (config.allowedOrigins.includes("*")) return;
  if (origin === null || !config.allowedOrigins.includes(origin)) {
    throw new AccessDeniedError(`origin not allowed: ${origin ?? "(none)"}`);
  }
}

export function assertTargetAllowed(host: string, port: number, config: RelayAccessConfig): void {
  if (config.allowedHosts.length === 0) {
    throw new AccessDeniedError("relay is not configured: set ALLOWED_HOSTS before deploying");
  }
  if (!config.allowedPorts.includes(port)) {
    throw new AccessDeniedError(`port not allowed: ${port}`);
  }

  const candidate = host.toLowerCase();
  const allowed = config.allowedHosts.some((entry) => {
    if (entry === "*") return true;
    if (entry.startsWith("*.")) {
      const suffix = entry.slice(1); // ".example.com"
      return candidate.endsWith(suffix) && candidate.length > suffix.length;
    }
    return entry === candidate;
  });

  if (!allowed) {
    throw new AccessDeniedError(`host not allowed: ${host}`);
  }
}
