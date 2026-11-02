export function parseKeepaliveMaxGraceMs(env: Record<string, string | undefined>): number | null {
  const value = env.KEEPALIVE_MAX_SECONDS;
  if (value === undefined || value === "") return env.ALLOWED_ORIGINS === "*" ? 0 : 3_600_000;
  if (value === "unlimited") return null;
  if (!/^(0|[1-9]\d*)$/.test(value) || Number(value) > 2_147_483) {
    throw new Error("invalid KEEPALIVE_MAX_SECONDS");
  }
  return Number(value) * 1000;
}
