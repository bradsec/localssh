export interface RelayCapabilities {
  resume: boolean;
  maxGraceMs: number | null;
}

export function capabilitiesUrl(wsUrl: string): string {
  const url = new URL(wsUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/capabilities`;
  url.search = "";
  url.hash = "";
  return url.href;
}

export async function fetchRelayCapabilities(
  wsUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RelayCapabilities | "unknown"> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetchImpl(capabilitiesUrl(wsUrl), { signal: controller.signal });
    if (!response.ok) return "unknown";
    const body: unknown = await response.json();
    if (!body || typeof body !== "object") return "unknown";
    const { resume, maxGraceMs } = body as Record<string, unknown>;
    if (typeof resume !== "boolean") return "unknown";
    if (
      maxGraceMs !== null &&
      (typeof maxGraceMs !== "number" || !Number.isSafeInteger(maxGraceMs) || maxGraceMs < 0)
    ) {
      return "unknown";
    }
    return { resume, maxGraceMs: maxGraceMs as number | null };
  } catch {
    return "unknown";
  } finally {
    clearTimeout(timer);
  }
}
