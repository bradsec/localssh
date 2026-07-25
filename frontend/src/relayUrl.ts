interface BrowserLocation {
  protocol: string;
  host: string;
}

export function resolveRelayWsUrl(
  configuredUrl: string | undefined,
  location: BrowserLocation,
): string {
  if (configuredUrl?.trim()) return configuredUrl;

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/relay`;
}
