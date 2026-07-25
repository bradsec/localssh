import { getDB } from "./db.js";

export async function loadKnownHosts(): Promise<Map<string, string>> {
  const all = await (await getDB()).getAll("knownHosts");
  return new Map(all.map((entry) => [entry.hostPort, entry.fingerprint]));
}

export async function trustHostKey(
  hostPort: string,
  fingerprint: string,
): Promise<void> {
  await (await getDB()).put("knownHosts", { hostPort, fingerprint });
}
