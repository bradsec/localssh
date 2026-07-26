import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDB } from "idb";

function deleteTestDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("localssh");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("database deletion was blocked by an open test connection"));
  });
}

describe("db", () => {
  beforeEach(async () => {
    vi.resetModules();
    await deleteTestDatabase();
  });

  it("opens with only the known hosts store", async () => {
    const { getDB } = await import("./db.js");
    const db = await getDB();
    expect([...db.objectStoreNames]).toEqual(["knownHosts"]);
    db.close();
  });

  // Anyone who ran an earlier build has a profiles store on disk. Upgrading
  // has to remove it rather than leave it stranded.
  it("drops a profiles store left by an earlier version", async () => {
    const legacy = await openDB("localssh", 1, {
      upgrade(db) {
        const profiles = db.createObjectStore("profiles", { keyPath: "id" });
        profiles.createIndex("by-folder", "folder");
        db.createObjectStore("knownHosts", { keyPath: "hostPort" });
      },
    });
    await legacy.put("knownHosts", {
      hostPort: "10.0.0.4:22",
      fingerprint: "SHA256:abc",
    });
    legacy.close();

    const { getDB } = await import("./db.js");
    const db = await getDB();

    expect([...db.objectStoreNames]).toEqual(["knownHosts"]);
    expect(await db.get("knownHosts", "10.0.0.4:22")).toEqual({
      hostPort: "10.0.0.4:22",
      fingerprint: "SHA256:abc",
    });
    db.close();
  });
});
