// Opt-in memory of the last target, for people who reconnect to the same box.
//
// Only the host and port are ever stored. Usernames and passwords are
// deliberately excluded: a username is an account identifier, and a password
// belongs nowhere but memory for the life of the connection.

export interface LastHost {
  host: string;
  port: number;
}

const STORAGE_KEY = "lastHost";
const ENABLED_KEY = "rememberLastHost";

export function loadRememberHost(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === "true";
  } catch {
    return false; // storage blocked, e.g. Safari private browsing
  }
}

export function saveRememberHost(enabled: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, String(enabled));
    if (!enabled) localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage is unavailable; the preference simply does not persist.
  }
}

export function loadLastHost(): LastHost | null {
  if (!loadRememberHost()) return null;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;

    const { host, port } = parsed as Record<string, unknown>;
    if (typeof host !== "string" || host === "") return null;
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
      return null;
    }
    return { host, port };
  } catch {
    return null;
  }
}

export function saveLastHost(last: LastHost): void {
  if (!loadRememberHost()) return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ host: last.host, port: last.port }));
  } catch {
    // Storage is unavailable; the host simply does not persist.
  }
}
