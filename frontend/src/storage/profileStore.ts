import { getDB, type ConnectionProfile } from "./db.js";

export async function listProfiles(): Promise<ConnectionProfile[]> {
  return (await getDB()).getAll("profiles");
}

export async function saveProfile(
  profile: ConnectionProfile,
): Promise<void> {
  await (await getDB()).put("profiles", profile);
}

export async function deleteProfile(id: string): Promise<void> {
  await (await getDB()).delete("profiles", id);
}
