# T13c feature builder report

Building: Files transfer states X-01 to X-04 within a session, for phone and desktop users of Files. Done means the download block shows the `10` §4.7 text per state, non-Cancel controls are disabled while resuming, announcements are throttled, downloads use the segmented writer, and the recovery row reports a stopped download.

## Assumptions

- X-02 vs X-03: both occur while `transport === "resuming"`; X-02 when `document.visibilityState === "hidden"`, else X-03. The plan gives FilePanel only the transport prop.
- X-04 is the return from resuming to connected during a download: the block returns to the X-01 text and the live region reads `Download resumed.`.
- "Controls other than Cancel are disabled while resuming": Up, Refresh, Upload, path Open, breadcrumbs, row Download buttons, drop. `Close files` stays enabled (escape hatch; with a transfer it opens the existing Stop transfer confirmation, which already covers X-02 and X-03; X-05 is T13d).
- X-01 hint ("Keep localssh open...") shows on coarse pointers only (`10` marks it touch only).
- `FilePanelProps` also gained `identity: {host, port, username}` (required) because `DownloadRecord` needs host, port and user, and `onDownloadStop?` for the recovery-row line. Neither is in the plan's interface list.
- The record's `size` and `mtime` come from the listing entry, not `onStart`. T13d may switch to `onStart`.
- Record lifetime: finished download deletes its record when the save link is released; user cancel or a non-connection failure deletes it; a connection-closed failure keeps the record and its committed segments (for T13d). `sweepDownloads` purges after 24 h.
- Fallback to the in-memory path when `createWritable` is missing: the record and segment 0 are removed first.
- Upload keeps current text; its announcement is throttled the same way.
- Announcement wording is `Downloading <name>, <N> percent.` (not `...: N%`) so it never duplicates the visible line for text queries. Other texts: `Download of <name> paused.`, `Resuming <name>.`, `Download resumed.`.

## Built and files changed

- `frontend/src/components/FilePanel.tsx`: `FilePanelProps` exported; `receiveFile` uses `openSegmentedDownload`; transfer block (X-01 to X-03); `locked` replaces `!!busy` on controls; visually hidden live region driven by state-change/25 percent logic (adjusted during render, no effect); `onDownloadStop` calls.
- `frontend/src/components/RecoveryRow.tsx`: `stoppedDownload` prop renders `Download of <name> stopped at <N>%.`.
- `frontend/src/App.tsx`: passes `transport`, `identity`, `onDownloadStop` (stored on `tab.download`, cleared on a new handle), `stoppedDownload` to the row.
- `frontend/src/app.css`: `.file-panel__transfer` styles.
- Tests: `FilePanel.test.tsx` (renderPanel takes extra props, new `transfer states` describe, 9 tests), new `RecoveryRow.test.tsx` (2 tests).
- Fixtures/mocks/type-only sites changed: only `renderPanel` in `FilePanel.test.tsx` (new required props). Existing assertions untouched.

## Tests added

X-01 live percent; X-02 text; X-03 text with Refresh, Download, Upload disabled and Cancel enabled; X-04 return plus `Download resumed.`; close confirmation while resuming; announcements at 0/25/50 only; segmented record created and removed on release; stopped report kept on `connection closed`; cleared on cancel; RecoveryRow line present/absent.

## Checks (Node 26.13.0)

- `rtk npm test -- src/components/FilePanel.test.tsx`: `Tests 34 passed (34)`.
- `rtk npm test`: `Test Files 36 passed (36)`, `Tests 460 passed (460)` (before adding RecoveryRow.test.tsx; with it, RecoveryRow + App files: 75 passed).
- `rtk npx tsc -b`: no errors. `rtk npm run lint`: no warnings. `rtk npm run format:check`: all files formatted.
- `rtk npm run test:e2e -- e2e/connect-flow.spec.ts --browser=chromium --grep "uploads and downloads" --reporter=line`: `1 passed (10.4s)`.
- No test relay left on 8788.

## Unverified

- Real background transitions on iOS (X-02 text) and OPFS stream survival across suspension: device test only.
- The full-suite count after adding `RecoveryRow.test.tsx` was not re-run as one whole-suite command.
- The recovery-row line has no App-level or E2E test (unit test of RecoveryRow only).

## Notes for the lead

- T13d: connection-closed failures leave the record in IndexedDB; `tab.download` in App clears on Reconnect (new handle), so X-07 must come from `listRecords`, not from `tab.download`.
- Plan file list did not mention `identity`; T13d's host/port/user listing can reuse it.
