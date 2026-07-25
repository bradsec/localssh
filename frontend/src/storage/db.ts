import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export interface ConnectionProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  folder: string | null;
}

export interface KnownHost {
  hostPort: string;
  fingerprint: string;
}

interface AppDB extends DBSchema {
  profiles: {
    key: string;
    value: ConnectionProfile;
    indexes: { "by-folder": string };
  };
  knownHosts: {
    key: string;
    value: KnownHost;
  };
}

let dbPromise: Promise<IDBPDatabase<AppDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<AppDB>> {
  if (!dbPromise) {
    dbPromise = openDB<AppDB>("localssh", 1, {
      upgrade(db) {
        const profiles = db.createObjectStore("profiles", { keyPath: "id" });
        profiles.createIndex("by-folder", "folder");
        db.createObjectStore("knownHosts", { keyPath: "hostPort" });
      },
    });
  }

  return dbPromise;
}
