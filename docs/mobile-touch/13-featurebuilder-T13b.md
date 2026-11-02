# T13b feature builder report

Building: a segmented OPFS download writer and an IndexedDB transfer record store, for the T13c/T13d download-resume UI. Done means a download is written as 4 MiB segment files with a record that tracks committed bytes, survives an abort at the last closed segment, is purged after 24 h, and `sweepDownloads` keeps live segments and removes orphans.

## Assumptions

- Database: the `downloads` store lives in its own IndexedDB database `localssh-downloads` (version 1), not in `localssh`. Adding a store to `localssh` needs a version bump, and an older tab holding `localssh` v2 open would block it; `vaultStore.ts:93` uses its own database for the same reason, and `vaultStore.test.ts:27` tests that case. This also leaves `storage/db.ts` and `db.test.ts:20` (which asserts the store list) untouched. HIGH.
- Signatures take the directory explicitly: `deleteRecord(directory, id)` and `purgeOld(directory, now)`, matching `openSegmentedDownload(dir, record)`. The plan writes `deleteRecord(id)` and `purgeOld(now)`. Taking the handle avoids an import cycle with `remoteFiles.ts` (`originDirectory`), which now imports from `downloadStore.ts`. MED.
- "A missing segment marks the record unusable" is a query, `recordIsUsable(directory, record)`: false when any listed segment is missing (`NotFoundError`) or the segment sizes do not sum to `committedBytes`. Other storage errors propagate. The record itself is not changed; T13d restarts cleanly (`deleteRecord` then a new record). MED.
- `openSegmentedDownload` saves the record before any segment exists, so a sweep in another window never sees a segment without its record. On resume it requires `committedBytes === segments.length * 4 MiB` and throws `download record does not match its segments` otherwise. It does not itself call `recordIsUsable`; T13d does that before resuming. MED.
- `abort()` aborts the open stream, removes the partial segment file, and keeps the record (for resume). Cancel = `abort()` then `deleteRecord()`, the caller's job. `write` after `finish`/`abort` rejects with `download writer is closed`.
- `finish()` commits the last partial segment (so `committedBytes` reaches the full size) and returns `new Blob(segmentFiles)`. It does not delete the record: the Blob reads from the segment files, so the caller deletes the record when it releases the save link (T13d: "deletes the record").
- `tail()` returns up to 4096 bytes (`TAIL_BYTES`, from `11` §6) ending at `committedBytes`, read from the last closed segment; empty when nothing is committed.
- Records store exactly the 10 plan fields; extra properties on the caller's object are dropped (`11` T-07).
- `sweepDownloads` now runs `purgeOld` first, so the 24 h limit (`11` T-07) is enforced by the one cleanup that already runs on mount (`FilePanel.tsx:233`). If IndexedDB fails, it logs, skips segment removal (no orphan can be proven), and still runs the existing 10-minute copy sweep. MED: the plan lists purge and sweep separately and does not say who calls `purgeOld`.
- Orphan segments are removed without an age gate: a live writer's record always exists first, so any `localssh-dl-<id>-*` file without a record is an orphan.
- Sweep tests sit in `downloadStore.test.ts` (the plan lists them under that test file's test-first list), so no `remoteFiles.test.ts` or `fileExplorer.test.ts` change was needed.

## Built and files changed

- New `frontend/src/downloadStore.ts`: `DownloadRecord`, `SegmentedDownload`, constants `SEGMENT_PREFIX = "localssh-dl-"`, `SEGMENT_BYTES` (4 MiB), `TAIL_BYTES` (4096), `RECORD_MAX_AGE_MS` (24 h); `segmentName`, `listRecords`, `deleteRecord`, `purgeOld`, `recordIsUsable`, `openSegmentedDownload`. Uses the existing `idb` dependency. No new dependency.
- Modified `frontend/src/remoteFiles.ts`: `sweepDownloads` purges expired records and removes segment files whose id has no record; the existing `localssh-download-` 10-minute behavior is unchanged (FilePanel test "sweeps only download copies older than ten minutes" still passes).
- New `frontend/src/downloadStore.test.ts`.
- No fixtures, mocks or type-only call sites needed changes. No other files touched.

## Tests added (`src/downloadStore.test.ts`, 12)

fake-indexeddb (`test-setup.ts`) plus an in-memory fake directory whose writable streams commit only on `close()` and discard on `abort()`, as OPFS does.

- 9 MiB written in 1.5 MiB chunks gives 3 segments (4, 4, 1 MiB), a Blob equal to the input, and `committedBytes` 9 MiB.
- The record exists before any segment.
- Abort at 8.5 MiB leaves `committedBytes` 8 MiB, two segments, no partial third file; later writes reject.
- `tail()` is empty at 0 and equals the 4 KiB before 4 MiB after 5 MiB written.
- Resume of a stored record continues from `committedBytes` and finishes with the full source.
- A record whose bytes do not fill its segments is refused.
- Missing or short segment: `recordIsUsable` false.
- `deleteRecord` removes the record and its segments, leaves unrelated files.
- `purgeOld` removes records older than 24 h with their segments, keeps fresh ones.
- Records contain only the 10 fields; a password and token passed in are not stored.
- Sweep keeps a live record's segments, removes an orphan segment and an old copy, leaves other apps' files.
- Sweep purges an expired record and its segments.

Red first: the run before `downloadStore.ts` existed failed on the missing module. With `downloadStore.ts` in place and `remoteFiles.ts` temporarily set to its HEAD content, the two sweep tests failed (`× keeps segments of live records and removes orphans`, `× purges expired records before sweeping`; `Tests 2 failed | 10 passed (12)`); the new version was then restored.

## Spec coverage

Requirement | Code | Test
--- | --- | ---
`DownloadRecord` fields, IndexedDB store `downloads` | `downloadStore.ts` `DownloadRecord`, `getDB` | "stores only the transfer identity"
`openSegmentedDownload` write/finish/abort/tail, segment `localssh-dl-<id>-<n>` every 4 MiB, `committedBytes` after each close | `openSegmentedDownload` | 9 MiB, abort, tail, resume tests
`listRecords`, `deleteRecord` removes segments, `purgeOld` > 24 h | same file | delete and purge tests
Missing segment marks the record unusable | `recordIsUsable` | "missing or short segment"
`sweepDownloads` keeps live segments | `remoteFiles.ts` | both sweep tests, existing FilePanel sweep test
No credentials in records (`11` T-07) | `storedRecord` field copy | "stores only the transfer identity"

## Verification (Node 26.13.0 on PATH)

- Task command `rtk npm test -- src/downloadStore.test.ts`: `Test Files 1 passed (1)`, `Tests 12 passed (12)`.
- V-FE:
  - `rtk npm test`: `Test Files 36 passed (36)`, `Tests 451 passed (451)`.
  - `rtk npm run build`: `✓ built in 192ms` (tsc -b clean; the first build failed on `noUncheckedIndexedAccess` errors in the new test file, fixed with an `onlyRecord()` helper).
  - `rtk npm run lint`: prints `> oxlint` only; `rtk proxy npx oxlint` exit 0.
  - `rtk npm run format:check`: `All matched files use the correct format.` (`oxfmt` reformatted `downloadStore.ts` and its test once.)

## Self-review

- R1 | LOW | `downloadStore.test.ts` | `toEqual` on 9 MiB arrays timed out (5 s) | replaced with a `sameBytes` loop; runtime 585 ms.
- No debug output, dead code, or edits outside the write set. No change needed elsewhere.

## Unverified

- Real OPFS behavior (Chromium, WebKit): not exercised, since nothing calls the writer until T13c. In particular, whether `removeEntry` on a segment with an open writable fails in Chromium (lock) is not checked; `deleteRecord` callers should `abort()` first.
- jsdom `Blob` from `File` parts stands in for OPFS `File` objects in the Blob test.

## Notes for the lead

- T13c/T13d: call `recordIsUsable` before resuming, `abort()` before `deleteRecord()` on cancel, and `deleteRecord()` only after the save link built from `finish()` is released. Store `mtime` from `onStart` (T13a note).
- Plan signature deltas: `deleteRecord(directory, id)` and `purgeOld(directory, now)`; database `localssh-downloads` rather than a store in `localssh`.
- No commits or branches were made.
