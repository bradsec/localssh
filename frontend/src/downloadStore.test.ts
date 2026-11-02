import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type DownloadRecord,
  RECORD_MAX_AGE_MS,
  SEGMENT_BYTES,
  TAIL_BYTES,
  deleteRecord,
  listRecords,
  openSegmentedDownload,
  purgeOld,
  recordIsUsable,
  segmentName,
} from "./downloadStore.js";
import { sweepDownloads } from "./remoteFiles.js";

const MiB = 1024 * 1024;

// An in-memory origin directory. Like OPFS, a writable stream's data becomes
// visible only when the stream closes; abort discards it.
function fakeDirectory(initial: Record<string, { data?: Uint8Array; lastModified?: number }> = {}) {
  const files = new Map<string, { data: Uint8Array; lastModified: number }>(
    Object.entries(initial).map(([name, file]) => [
      name,
      { data: file.data ?? new Uint8Array(), lastModified: file.lastModified ?? Date.now() },
    ]),
  );
  const directory = {
    async getFileHandle(name: string, opts?: { create?: boolean }) {
      if (!files.has(name)) {
        if (!opts?.create) throw new DOMException("missing", "NotFoundError");
        files.set(name, { data: new Uint8Array(), lastModified: Date.now() });
      }
      return {
        async createWritable() {
          const parts: Uint8Array[] = [];
          return {
            async write(data: Uint8Array) {
              parts.push(new Uint8Array(data));
            },
            async close() {
              const file = files.get(name);
              if (!file) throw new DOMException("removed", "NotFoundError");
              file.data = concat(parts);
            },
            async abort() {},
          };
        },
        async getFile() {
          const file = files.get(name);
          if (!file) throw new DOMException("missing", "NotFoundError");
          return new File([file.data.slice()], name, { lastModified: file.lastModified });
        },
      };
    },
    async removeEntry(name: string) {
      if (!files.delete(name)) throw new DOMException("missing", "NotFoundError");
    },
    async *keys() {
      yield* [...files.keys()];
    },
  };
  return { directory: directory as unknown as FileSystemDirectoryHandle, files };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function pattern(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = (i * 31 + (i >> 12)) & 0xff;
  return bytes;
}

async function writeInChunks(
  writer: { write(chunk: Uint8Array): Promise<void> },
  data: Uint8Array,
  chunk: number,
) {
  for (let offset = 0; offset < data.byteLength; offset += chunk) {
    await writer.write(data.subarray(offset, offset + chunk));
  }
}

function newRecord(overrides: Partial<DownloadRecord> = {}): DownloadRecord {
  return {
    id: crypto.randomUUID(),
    host: "files.example",
    port: 22,
    user: "alice",
    remotePath: "/srv/big.bin",
    size: 9 * MiB,
    mtime: 1793592649000,
    committedBytes: 0,
    segments: [],
    createdAt: Date.now(),
    ...overrides,
  };
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

async function onlyRecord(): Promise<DownloadRecord> {
  const records = await listRecords();
  expect(records).toHaveLength(1);
  return records[0]!;
}

// Element-wise toEqual on megabytes is too slow for the test timeout.
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.byteLength === b.byteLength && a.every((byte, i) => byte === b[i]);
}

beforeEach(async () => {
  const { directory } = fakeDirectory();
  for (const record of await listRecords()) await deleteRecord(directory, record.id);
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "storage");
});

describe("segmented download", () => {
  it("writes 9 MiB as three segments and finishes with the same bytes", async () => {
    const { directory, files } = fakeDirectory();
    const record = newRecord();
    const source = pattern(9 * MiB);
    const writer = await openSegmentedDownload(directory, record);

    // 1.5 MiB chunks do not line up with segment boundaries.
    await writeInChunks(writer, source, 1.5 * MiB);
    const blob = await writer.finish();

    expect(blob.size).toBe(source.byteLength);
    expect(sameBytes(await blobBytes(blob), source)).toBe(true);
    const names = [0, 1, 2].map((n) => segmentName(record.id, n));
    expect([...files.keys()].sort()).toEqual(names);
    expect(files.get(segmentName(record.id, 0))!.data.byteLength).toBe(SEGMENT_BYTES);
    expect(files.get(segmentName(record.id, 2))!.data.byteLength).toBe(1 * MiB);
    const stored = await onlyRecord();
    expect(stored.segments).toEqual(names);
    expect(stored.committedBytes).toBe(9 * MiB);
  });

  it("records the record before any segment exists", async () => {
    const { directory } = fakeDirectory();
    const record = newRecord();
    await openSegmentedDownload(directory, record);
    expect(await listRecords()).toEqual([record]);
  });

  it("keeps committed segments when aborted mid-segment", async () => {
    const { directory, files } = fakeDirectory();
    const record = newRecord();
    const source = pattern(9 * MiB);
    const writer = await openSegmentedDownload(directory, record);

    await writeInChunks(writer, source.subarray(0, 8.5 * MiB), 1 * MiB);
    await writer.abort();

    const stored = await onlyRecord();
    expect(stored.committedBytes).toBe(8 * MiB);
    expect(stored.segments).toEqual([segmentName(record.id, 0), segmentName(record.id, 1)]);
    // The partial third segment is not kept.
    expect(files.has(segmentName(record.id, 2))).toBe(false);
    expect(await recordIsUsable(directory, stored)).toBe(true);
    await expect(writer.write(new Uint8Array(1))).rejects.toThrow("download writer is closed");
  });

  it("returns the bytes just before the committed offset as the tail", async () => {
    const { directory } = fakeDirectory();
    const record = newRecord();
    const source = pattern(9 * MiB);
    const writer = await openSegmentedDownload(directory, record);
    expect(await writer.tail()).toEqual(new Uint8Array());

    await writeInChunks(writer, source.subarray(0, 5 * MiB), 1 * MiB);
    expect(await writer.tail()).toEqual(source.subarray(4 * MiB - TAIL_BYTES, 4 * MiB));
  });

  it("resumes a stored record from its committed offset", async () => {
    const { directory } = fakeDirectory();
    const source = pattern(9 * MiB);
    const first = await openSegmentedDownload(directory, newRecord());
    await writeInChunks(first, source.subarray(0, 6 * MiB), 2 * MiB);
    await first.abort();

    const stored = await onlyRecord();
    const resumed = await openSegmentedDownload(directory, stored);
    expect(await resumed.tail()).toEqual(source.subarray(4 * MiB - TAIL_BYTES, 4 * MiB));
    await writeInChunks(resumed, source.subarray(stored.committedBytes), 2 * MiB);
    expect(sameBytes(await blobBytes(await resumed.finish()), source)).toBe(true);
  });

  it("refuses a record whose committed bytes do not fill its segments", async () => {
    const { directory } = fakeDirectory();
    const record = newRecord({ committedBytes: 3, segments: ["localssh-dl-x-0"] });
    await expect(openSegmentedDownload(directory, record)).rejects.toThrow(
      "download record does not match its segments",
    );
  });

  it("marks a record with a missing or short segment as unusable", async () => {
    const { directory, files } = fakeDirectory();
    const writer = await openSegmentedDownload(directory, newRecord());
    await writeInChunks(writer, pattern(8 * MiB), 1 * MiB);
    await writer.abort();
    const stored = await onlyRecord();
    expect(await recordIsUsable(directory, stored)).toBe(true);

    files.get(stored.segments[1]!)!.data = new Uint8Array(10);
    expect(await recordIsUsable(directory, stored)).toBe(false);
    files.delete(stored.segments[1]!);
    expect(await recordIsUsable(directory, stored)).toBe(false);
  });

  it("deletes a record and its segments", async () => {
    const { directory, files } = fakeDirectory({ "unrelated.txt": {} });
    const writer = await openSegmentedDownload(directory, newRecord());
    await writeInChunks(writer, pattern(5 * MiB), 1 * MiB);
    await writer.abort();
    const stored = await onlyRecord();

    await deleteRecord(directory, stored.id);

    expect(await listRecords()).toEqual([]);
    expect([...files.keys()]).toEqual(["unrelated.txt"]);
  });

  it("purges records older than 24 hours with their segments", async () => {
    const now = Date.now();
    const { directory, files } = fakeDirectory();
    const old = newRecord({ createdAt: now - RECORD_MAX_AGE_MS - 1 });
    const fresh = newRecord({ createdAt: now - RECORD_MAX_AGE_MS + 60_000 });
    for (const record of [old, fresh]) {
      const writer = await openSegmentedDownload(directory, record);
      await writeInChunks(writer, pattern(4 * MiB), 1 * MiB);
      await writer.abort();
    }

    await purgeOld(directory, now);

    expect((await listRecords()).map((record) => record.id)).toEqual([fresh.id]);
    expect([...files.keys()]).toEqual([segmentName(fresh.id, 0)]);
  });

  it("stores only the transfer identity, never credentials", async () => {
    const { directory } = fakeDirectory();
    const writer = await openSegmentedDownload(directory, {
      ...newRecord(),
      password: "hunter2",
      token: "resume-token",
    } as DownloadRecord);
    await writeInChunks(writer, pattern(4 * MiB), 1 * MiB);
    await writer.abort();

    const stored = await onlyRecord();
    expect(Object.keys(stored).sort()).toEqual([
      "committedBytes",
      "createdAt",
      "host",
      "id",
      "mtime",
      "port",
      "remotePath",
      "segments",
      "size",
      "user",
    ]);
    expect(JSON.stringify(stored)).not.toMatch(/hunter2|resume-token/);
  });
});

describe("sweepDownloads with segments", () => {
  it("keeps segments of live records and removes orphans", async () => {
    const now = Date.now();
    const { directory, files } = fakeDirectory();
    const writer = await openSegmentedDownload(directory, newRecord());
    await writeInChunks(writer, pattern(4 * MiB), 1 * MiB);
    await writer.abort();
    const live = await onlyRecord();
    files.set("localssh-dl-gone-0", { data: new Uint8Array(4), lastModified: now });
    files.set("localssh-download-old", { data: new Uint8Array(), lastModified: now - 11 * 60_000 });
    files.set("other-app-file", { data: new Uint8Array(), lastModified: now - 60 * 60_000 });
    Object.defineProperty(navigator, "storage", {
      value: { getDirectory: async () => directory },
      configurable: true,
    });

    await sweepDownloads(now);

    expect([...files.keys()].sort()).toEqual([...live.segments, "other-app-file"].sort());
  });

  it("purges expired records before sweeping", async () => {
    const now = Date.now();
    const { directory, files } = fakeDirectory();
    const writer = await openSegmentedDownload(
      directory,
      newRecord({ createdAt: now - RECORD_MAX_AGE_MS - 1 }),
    );
    await writeInChunks(writer, pattern(4 * MiB), 1 * MiB);
    await writer.abort();
    Object.defineProperty(navigator, "storage", {
      value: { getDirectory: async () => directory },
      configurable: true,
    });

    await sweepDownloads(now);

    expect(await listRecords()).toEqual([]);
    expect(files.size).toBe(0);
  });
});
