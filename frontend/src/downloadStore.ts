// Resumable downloads: the data goes to origin-private files in fixed-size
// segments, and an IndexedDB record says which segments are complete. A
// writable stream commits nothing until close(), so each segment is closed
// as soon as it is full; eviction or a lost session then costs at most one
// segment.
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export const SEGMENT_PREFIX = "localssh-dl-";
export const SEGMENT_BYTES = 4 * 1024 * 1024;
/** Bytes before the committed offset that the engine compares on resume. */
export const TAIL_BYTES = 4096;
/** Partial downloads are user data in origin storage; keep them a day at most. */
export const RECORD_MAX_AGE_MS = 24 * 60 * 60_000;

/**
 * What a resume needs to find and check the remote file. It holds no
 * credentials or session tokens.
 */
export interface DownloadRecord {
  id: string;
  host: string;
  port: number;
  user: string;
  remotePath: string;
  /** Remote size and mtime (ms) as the engine reported them at start. */
  size: number;
  mtime: number;
  /** Bytes held in closed segments. */
  committedBytes: number;
  segments: string[];
  createdAt: number;
}

export interface SegmentedDownload {
  write(chunk: Uint8Array): Promise<void>;
  /** Closes the last segment and returns the whole file. */
  finish(): Promise<Blob>;
  /** Drops the open segment and keeps the record for a later resume. */
  abort(): Promise<void>;
  /** Up to TAIL_BYTES ending at the committed offset. */
  tail(): Promise<Uint8Array>;
}

interface DownloadsDB extends DBSchema {
  downloads: { key: string; value: DownloadRecord };
}

let dbPromise: Promise<IDBPDatabase<DownloadsDB>> | null = null;

// A database of its own: adding a store to "localssh" would need a version
// change, which an older tab holding that database open would block.
function getDB(): Promise<IDBPDatabase<DownloadsDB>> {
  dbPromise ??= openDB<DownloadsDB>("localssh-downloads", 1, {
    upgrade(db) {
      db.createObjectStore("downloads", { keyPath: "id" });
    },
  });
  return dbPromise;
}

export function segmentName(id: string, index: number): string {
  return `${SEGMENT_PREFIX}${id}-${index}`;
}

// Copies the known fields only, so nothing else a caller attaches is stored.
function storedRecord(record: DownloadRecord): DownloadRecord {
  return {
    id: record.id,
    host: record.host,
    port: record.port,
    user: record.user,
    remotePath: record.remotePath,
    size: record.size,
    mtime: record.mtime,
    committedBytes: record.committedBytes,
    segments: [...record.segments],
    createdAt: record.createdAt,
  };
}

export async function listRecords(): Promise<DownloadRecord[]> {
  return (await getDB()).getAll("downloads");
}

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotFoundError";
}

async function removeIfPresent(directory: FileSystemDirectoryHandle, name: string): Promise<void> {
  try {
    await directory.removeEntry(name);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

async function namesInDirectory(directory: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = [];
  for await (const name of (directory as unknown as { keys(): AsyncIterable<string> }).keys()) {
    names.push(name);
  }
  return names;
}

/** Deletes the record, then every segment file of that download. */
export async function deleteRecord(
  directory: FileSystemDirectoryHandle,
  id: string,
): Promise<void> {
  await (await getDB()).delete("downloads", id);
  // Matching by prefix also removes a segment that was open when the page died.
  const prefix = `${SEGMENT_PREFIX}${id}-`;
  for (const name of await namesInDirectory(directory)) {
    if (name.startsWith(prefix)) await removeIfPresent(directory, name);
  }
}

export async function purgeOld(
  directory: FileSystemDirectoryHandle,
  now = Date.now(),
): Promise<void> {
  for (const record of await listRecords()) {
    if (now - record.createdAt > RECORD_MAX_AGE_MS) await deleteRecord(directory, record.id);
  }
}

/**
 * Whether every committed segment is still there with the expected size.
 * Storage eviction can remove some; such a record must restart from 0.
 */
export async function recordIsUsable(
  directory: FileSystemDirectoryHandle,
  record: DownloadRecord,
): Promise<boolean> {
  let total = 0;
  for (const name of record.segments) {
    try {
      total += (await (await directory.getFileHandle(name)).getFile()).size;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }
  return total === record.committedBytes;
}

/**
 * Starts a download, or continues one from a stored record's committedBytes.
 * The record is saved before any data is written, so a sweep never sees a
 * segment without its record.
 */
export async function openSegmentedDownload(
  directory: FileSystemDirectoryHandle,
  initial: DownloadRecord,
): Promise<SegmentedDownload> {
  const record = storedRecord(initial);
  if (record.committedBytes !== record.segments.length * SEGMENT_BYTES) {
    throw new Error("download record does not match its segments");
  }
  const db = await getDB();
  await db.put("downloads", storedRecord(record));

  let open: { name: string; stream: FileSystemWritableFileStream; bytes: number } | null = null;
  let closed = false;

  async function commitOpenSegment(): Promise<void> {
    if (!open) return;
    const segment = open;
    open = null;
    await segment.stream.close();
    record.segments.push(segment.name);
    record.committedBytes += segment.bytes;
    await db.put("downloads", storedRecord(record));
  }

  async function segmentFile(name: string): Promise<File> {
    return (await directory.getFileHandle(name)).getFile();
  }

  return {
    async write(chunk) {
      if (closed) throw new Error("download writer is closed");
      let offset = 0;
      while (offset < chunk.byteLength) {
        if (!open) {
          const name = segmentName(record.id, record.segments.length);
          const handle = await directory.getFileHandle(name, { create: true });
          open = { name, stream: await handle.createWritable(), bytes: 0 };
        }
        const take = Math.min(SEGMENT_BYTES - open.bytes, chunk.byteLength - offset);
        // A copy: the engine may reuse the chunk's buffer after this resolves.
        await open.stream.write(chunk.slice(offset, offset + take));
        open.bytes += take;
        offset += take;
        if (open.bytes === SEGMENT_BYTES) await commitOpenSegment();
      }
    },

    async finish() {
      if (closed) throw new Error("download writer is closed");
      closed = true;
      await commitOpenSegment();
      return new Blob(await Promise.all(record.segments.map(segmentFile)));
    },

    async abort() {
      if (closed) return;
      closed = true;
      if (!open) return;
      const segment = open;
      open = null;
      await segment.stream.abort();
      await removeIfPresent(directory, segment.name);
    },

    async tail() {
      const last = record.segments.at(-1);
      if (!last) return new Uint8Array();
      const file = await segmentFile(last);
      return new Uint8Array(await file.slice(Math.max(0, file.size - TAIL_BYTES)).arrayBuffer());
    },
  };
}
