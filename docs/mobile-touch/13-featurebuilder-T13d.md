# T13d feature builder report

Building: download resume after session expiry, page reload or eviction, for Files users on phone and desktop. Done means: Files lists this host's stopped download (X-07), `Resume download` continues by byte offset with the engine's identity and tail check, a changed remote file shows X-06 with Retry from 0, Cancel/Dismiss delete the record and its segments, and a missing segment restarts cleanly.

## Assumptions

- X-07 shows the newest stored record for this host, port and user (`identity` from T13c). Its percent is `committedBytes / size`, the point where resume starts. It can be lower than the recovery row's live percent (for example, the row says 57% and X-07 says 50%). MED.
- "Each failure state shows only the actions that can work": X-07 hides `Resume download` when `recordIsUsable` is false at mount. When a segment disappears after mount, `Resume download` rechecks, deletes the record and restarts from 0 ("clean restart"). MED.
- `Dismiss` (X-07) deletes the record and its segments, like Cancel. Otherwise the block would come back each time Files opens until the 24 h purge. MED.
- Retry (X-06, X-07) needs the current size and mtime for a new record, so it lists the parent folder and finds the file there. If the file is gone, it shows the existing "no such file" toast. A file beyond the 10,000-entry listing cap is reported the same way. MED.
- X-05 is shown when a download fails without a user cancel because the file connection closed or the engine cancelled it, and Files is still open. Its second line is the existing `describeSftpFailure` text ("Files is no longer connected..."). The `10` sample text, "The server did not answer in time.", describes a timeout, and the engine has no request timeout. MED.
- `Stop and close` (the close confirmation) counts as a user cancel and discards the partial bytes, because the text says "Closing Files stops it". In X-05 it also deletes the kept record. MED.
- `onStart` is not passed. The record keeps the size and mtime from the listing, which T13a says equal the engine's `onStart` values. A resume needs no start callback. The plan's interface line lists `onStart`. LOW.
- Starting another transfer while X-05/X-06/X-07 shows replaces the block. The record stays and shows as X-07 the next time Files opens (within 24 h).
- A module-level set of record ids that are downloading or held in this page keeps a second Files panel for the same host (another tab) from offering a live download as stopped. Other browser windows are not covered.

## Root cause found while building (fixes a T13c gap)

When a session ends, the engine closes the SFTP bridge, which cancels the active transfer (`engine/sftpjs.go:79-96`, `ErrCancelled` "transfer cancelled"). FilePanel is still mounted at that moment. T13c kept the record only for `connection closed`-type text, so on a real expiry `receiveFile` deleted the partial bytes and X-07 never appeared. I confirmed this in the E2E with temporary page logging: `TMPDEBUG transfer cancelled true false false`, then no records. Fix: `receiveFile` no longer decides. On failure the component keeps the record unless the user cancelled (`cancelled` ref, now also set by `Stop and close`) or the failure is something other than a closed connection, an unrequested cancel, or Files unmounting.

## Built and files changed

- `frontend/src/components/FilePanel.tsx`:
  - New: `activeDownloads`, `committedPercent`, `newRecord`, `remoteBase`, `StoppedDownload`, `TRANSFER_CANCELLED`.
  - `receiveFile(files, record, resume, filename, onProgress)` takes the record. On resume it calls `download(path, write, progress, { offset: committedBytes, expectSize, expectMtime, tail })`; other calls keep the 3-argument form.
  - A mount effect lists records for host, port and user (X-07).
  - `download(remotePath, shown, remote, resume?)` decides whether to keep the record and sets X-05/X-06.
  - New handlers `discardStopped`, `retryStopped`, `resumeStopped`, `runStopped`.
  - The `role="alert"` block for X-05 to X-07.
  - The close confirmation now also covers X-05 (`unfinished`).
- `frontend/src/components/FilePanel.test.tsx`: imports from `downloadStore`, cleans up IndexedDB records in `beforeEach`, new `segmentDirectory()` per-file OPFS fake, new `download resume` describe.
- `frontend/e2e/connect-flow.spec.ts`: `utimesSync` import and a `download resume after expiry or eviction` describe with 2 tests.
- `frontend/src/app.css`: `.file-panel__transfer-actions` (action row, primary action at the right). This file is outside the plan's T13d list. It is a 7-line addition next to T13c's transfer styles.
- Fixtures/mocks/type-only call sites: only the `beforeEach` in `FilePanel.test.tsx`, which now clears stored records. A record kept by T13c's "connection closes mid-download" test would otherwise show X-07 in later tests. No existing assertion changed.

## Tests added

Component (`FilePanel.test.tsx`, `download resume`, 13 tests):

- X-07 resumes from the committed offset: `download` gets `offset` 4 MiB, the expected size and mtime, and the 4 KiB tail; the Blob equals the source.
- The record is deleted when the link is released.
- Other host, port or user: X-07 not offered.
- X-06 shows Cancel and Retry, no Resume. Retry lists the parent folder and downloads from 0 (3 arguments).
- X-05 after `connection closed` resumes from the offset.
- An unrequested `transfer cancelled` is treated as lost: X-05, record kept.
- The record is kept when Files unmounts mid-download.
- `Stop and close` discards it.
- The close confirmation covers X-05.
- Cancel deletes the record and its segments with no dialog.
- Dismiss deletes the record.
- A missing segment at mount offers only Retry and Dismiss.
- A segment lost before Resume restarts cleanly from 0 with a new record.

Red first: the first 9 failed before implementation (`Tests 9 failed | 35 passed (44)`; "does not offer records of another host" passed trivially). The unmount case failed before the keep/discard fix (`1 failed | 45 passed (46)`), and so did the unrequested-cancel case (`1 failed | 46 passed (47)`).

E2E (chromium):

- `on a phone › resumes an 8 MiB download by offset after the session expires and Reconnect`:
  - Setup: relay spawned with `KEEPALIVE_MAX_SECONDS=2`; OPFS writes slowed in the page.
  - Expiry is forced past 55%. The test checks for `Session expired.` and `Download of resume.bin stopped at N%.`, then Reconnect and the password.
  - Files shows `resume.bin stopped at 50% when the connection closed.`.
  - After `Resume download`, the saved file's SHA-256 equals the source, and exactly 4 MiB is written after the click.
- `offers resume after reload, restarts on a changed file or a missing segment`:
  - A reload mid-download, then login: X-07 at 50%.
  - `utimes` on the remote file, then Resume: X-06, no Resume button. Retry: hash equal, 8 MiB written.
  - A second reload mid-download, then one segment is removed from OPFS. Resume restarts from 0: hash equal, 8 MiB written.

## Checks (Node 26.13.0)

- `rtk npm test -- src/components/FilePanel.test.tsx`: `Test Files 1 passed (1)`, `Tests 47 passed (47)`.
- `rtk npm run test:e2e -- e2e/connect-flow.spec.ts --browser=chromium --reporter=line`: `23 passed (1.5m)`.
- V-FE:
  - `rtk npm test`: `Test Files 37 passed (37)`, `Tests 475 passed (475)`.
  - `npm run build`: exit 0, `✓ built in 192ms` (only the existing chunk-size advisory).
  - `npx oxlint`: exit 0, no output. `rtk npm run lint` also exits 0.
  - `rtk npm run format:check`: `All matched files use the correct format.`
- No relay left on 8787, 8788 or 4173 after the runs (`ss -ltn` empty for those ports).

## Self-review

- R1 | MED | FilePanel.tsx render | `runStopped(x)` built closures during render and `Date.now()` sat in the component body; oxlint flagged refs/purity | fixed: inline arrows and module `newRecord`.
- R2 | HIGH | FilePanel.tsx catch | an expiry deleted the partial bytes (engine cancel text) | fixed as described in "Root cause".
- R3 | LOW | temporary `TMPDEBUG` logging and E2E debug block | removed; `grep` finds none.
- No commented-out code, no new dependency, no edits outside the files listed.

## Unverified

- WebKit E2E for the new tests (only chromium ran, as the done-when command asks). `FileSystemWritableFileStream` patching in the E2E assumes Chromium.
- Real iOS eviction, suspension and OPFS behavior: device test only (release gate).
- The E2E percent gate (55%) depends on slowed OPFS writes. A much faster or slower machine could change the timing. After the fixes, each test passed in the 2 runs that included it: its own run and the full-spec run. Earlier failures came from the record-deletion bug and the test's own trust-prompt step, not from timing.

## Notes for the lead

- Adjacent, SUSPECTED, not fixed: on `pagehide`, the held finished download's `release()` deletes its record asynchronously, and a reload may cut that off. The next Files open could then offer a finished download as X-07 at 100%. Resume at offset = size writes nothing and finishes, so the effect is only a confusing prompt.
- Adjacent, CONFIRMED again, not fixed: Playwright global setup leaves `run-local-relay.ts 8787` orphaned under systemd after each run (T13a reported this). It was already running when I started (an orphan from a previous run, about 7 minutes old) and after each of my runs. I stopped it each time with `pkill -9 -f "run-local-relay[.]ts 8787"` before the next run.
- The plan's `onStart` in the resume call is not used (see Assumptions).
- Help/USER-GUIDE text for X-05 to X-07 is left to T19b.
- No commits or branches were made.
