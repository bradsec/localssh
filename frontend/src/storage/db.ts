import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export interface KnownHost {
  hostPort: string;
  fingerprint: string;
}

interface AppDB extends DBSchema {
  knownHosts: {
    key: string;
    value: KnownHost;
  };
}

let dbPromise: Promise<IDBPDatabase<AppDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<AppDB>> {
  if (!dbPromise) {
    dbPromise = openDB<AppDB>("localssh", 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore("knownHosts", { keyPath: "hostPort" });
        }
        // Version 1 shipped an unused profiles store. The address book
        // supersedes it, and leaving it behind would strand it on every
        // machine that ran that build.
        if (db.objectStoreNames.contains("profiles" as never)) {
          db.deleteObjectStore("profiles" as never);
        }
      },
    });
  }

  return dbPromise;
}
