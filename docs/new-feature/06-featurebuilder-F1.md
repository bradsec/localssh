# F1 SFTP feature build

BASE_F1: `79f1ed8b5719d750638f45bd83117865c3214f8c`

## Lead note

The Codex session reached its usage limit after its final checks and before it wrote the rest of this report. The lead re-ran verification on the uncommitted work: engine `go test ./...` (all packages ok), `GOOS=js GOARCH=wasm go vet ./...`, `./build.sh`; frontend `Tests  314 passed (314)`, `tsc -b`, lint, format check, build; Playwright `22 passed`; `docker build .` succeeded. New dependency: `github.com/pkg/sftp v1.13.12` (latest on proxy.golang.org, published 2026-10-23), justified because x/crypto/ssh has no SFTP client. Uploads write a temporary remote file and rename it into place (`engine/sftpjs.go:226-268`). The spec coverage table and self-review were not written; the change reviewer works from the F1 stub and the diff.

## Review fixes

Status: PARTIAL. Stopped at a green state because the Claude usage budget reached 85% (lead rule: stop green and report). No finding F1 to F10 is fixed end to end yet. Nothing is committed.

### Done (uncommitted)

- `engine/remotefiles/remotefiles.go` (new, platform-independent, not yet wired in or tested): `List` (ReadDir, then RealPath for the resolved path; Stat for symlinks to set kind file/folder/other/broken; removes `.localssh-upload-*` regular files older than 24 h), `Upload` (Lstat before writing returns `ErrExists`; Lstat again after a failed rename to map OpenSSH's generic failure to `ErrExists`; Chmod of the temp file to the replaced file's mode before rename; PosixRename when the server advertises `posix-rename@openssh.com`, otherwise Remove then Rename, keeping the temp and naming it if that rename fails; cancel through a context checked by the reader), `Download` (Stat follows links; `File.WriteTo` with a cancelling writer), and `ClientOptions` (concurrent reads and writes, `MaxConcurrentRequestsPerFile(16)`).
- `engine/sshclient/testserver.go`: `Lstat` now uses `os.Lstat`; `Setstat` applies permission bits; a rename onto an existing name returns a generic error (SSH_FX_FAILURE), as OpenSSH does.

Checks at this state: `go test ./...` "Go test: 85 passed in 5 packages"; `GOOS=js GOARCH=wasm go vet ./...` clean; `gofmt -l .` clean. Frontend checks, `./build.sh`, and Playwright were not run because the frontend is unchanged.

### Facts verified

- Safari `createWritable`: MDN browser-compat-data `api/FileSystemFileHandle.json` (main branch, read 2026-11-01) lists safari 26, with safari_ios mirroring it; `createSyncAccessHandle` is 15.2. This confirms F1: on Safari before 26, OPFS opens but `createWritable` is missing.
- OpenSSH rename onto an existing file: in `openssh-portable/sftp-server.c` (master, read 2026-11-01), `process_rename` calls `link()`, which fails with EEXIST, and `errno_to_portable` has no EEXIST case, so the reply is SSH2_FX_FAILURE. The server advertises `posix-rename@openssh.com` v1. This confirms F5.
- pkg/sftp v1.13.12 (local module source): `MaxConcurrentRequestsPerFile` (default 64), `UseConcurrentWrites`, and `UseConcurrentReads`. `File.ReadFrom` runs concurrently only when the reader has `Size()`/`Len()`/`Stat()`. `ReadFrom` and `WriteTo` hold `File.mu`, so the old cancel-by-`File.Close()` would block. Cancel has to go through the reader or writer instead.
- Released `js.Func` (Go 1.27.3 `syscall/js/func.go:106`): it logs "call to released function" and returns undefined. It does not panic. So F10's `Array.isArray` guard is needed, and upload or download after a close resolves undefined (a false success).
- OPFS probe (Playwright Chromium): reading a `File` or blob URL from `getFile()` after `removeEntry` fails with NotFoundError. **Conflict with the F2 instruction:** removing the temp right after the transfer completes breaks the browser's save and the "Save download" link. Proposed alternative: remove on failure, on the next transfer, on panel close, and on `pagehide`; keep the 10-minute timer; at startup, sweep `localssh-download-*` entries older than 10 minutes, so another window's live file survives.

### Remaining

1. Engine: add `engine/remotefiles/remotefiles_test.go` against `sshclient.NewTestServer`. Cover: a file larger than one 32 KiB chunk, cancel leaving no temp, symlink listing (dir, file, broken), stale-listing overwrite returning `ErrExists`, mode kept on Replace, the Remove-plus-Rename fallback via `sftp.SetSFTPExtensions` without posix-rename, and the stale temp sweep via `os.Chtimes`. Then rewrite `engine/sftpjs.go` as a thin adapter:
   - a JS `File` reader with `Size()`;
   - a chunk-callback writer;
   - context cancel in place of `File.Close`;
   - `list` returning `{path, entries}`;
   - typed `ErrExists` text;
   - close via `sync.Once` plus a done channel, so every caller waits for the active upload's temp removal (bounded) before `client.Close` (F7);
   - in `engine/main.go` `sessionBridge.close(nil)`, close the session only after `files.close()` when an upload is active.
2. Frontend:
   - `engine.ts`: `list` returns `{path, entries}`; `RemoteFile` gets `kind` and `isLink`.
   - `FilePanel.tsx`: F1 (`createWritable` inside the try, falling back to the 16 MiB path); F2 per the conflict above; F3 type labels; F4 Up control and resolved path; F5 typed error replaces the regex; F6 confirm text (permissions kept, owner and ACLs not, a link is replaced and not followed); F9 display escaping of bidi and control code points, raw name kept for operations; F10 confirm before Close files during a transfer, plus the `Array.isArray` guard.
   - Update `App.test.tsx` mocks (`isDir` in use at lines 157 and 164) and the e2e spec. Add tests for each.
3. F8 measurement: run a large file through a latency-injecting proxy, comparing serial and concurrent transfer. Not done; there are no numbers yet.
4. Help (`frontend/src/helpTopics.ts` files topic) and README (lines 371-381, "32 KiB chunks", cleanup wording) after the behavior lands.
5. F11 and F12 deferred, as instructed.

### Lead decision on F2 (2026-11-01)

Accepted the builder's alternative: deleting the OPFS temp file right after the download breaks the saved file in Chromium. Remove the temp file on failure, on the next transfer, on panel close, and on `pagehide`; keep the 10-minute timer; at startup sweep only `localssh-download-*` files older than 10 minutes.

## Review fixes, session 2

Status: DONE for F1 to F10, all checks green. Nothing committed (lead commits). F11 and F12 stay deferred.

### Spec read and assumptions

Building: the F1 review fixes for SFTP panel users; done means each finding F1 to F10 has code and a test, and every project check passes.

- F10 "calls after release must reject": Go's released `js.Func` returns undefined synchronously (verified in session 1). Assumption: guard in `engine.ts` (`guardSftp`, `openFiles`) that rejects with `FilesClosedError` whenever an engine call does not return a Promise, instead of never releasing funcs (which would leak a closed client per panel open). Before release, the engine rejects with "SFTP closed".
- F9 "display only": remote operations use the raw name; the shown name and the saved download file name use the escaped form (`<U+202E>`), because the save dialog is also a display.
- F5: the client-side `entries.some(...)` precheck is removed; the Replace prompt comes only from the engine's `Lstat`/`ErrExists` (exact text `remote file exists`).
- Close during a busy transfer: `sessionBridge.close` returns nil at once and finishes off the callback goroutine (the wait needs the JS event loop); its session close error is dropped in that path, `onClose` still fires.

### Fixes (ID -> files)

- F1 -> `frontend/src/components/FilePanel.tsx` (`getFileHandle` and `createWritable` inside the try; missing or throwing `createWritable` removes the temp entry and uses the 16 MiB in-memory path; failure after data moved still throws).
- F2 -> `FilePanel.tsx`, new `frontend/src/remoteFiles.ts` (per lead decision: copy removed on failure, next transfer, panel unmount, `pagehide`, and the 10-minute timer; `sweepDownloads` on mount removes only `localssh-download-*` older than 10 minutes by `lastModified`).
- F3 -> `engine/sftpjs.go` (list returns `kind`, `isLink`), `frontend/src/ssh/engine.ts` (`RemoteFileKind`, `RemoteListing`), `FilePanel.tsx` (labels: Folder, File, Link to folder, Link to file, Broken link, Special file; links to folders open; download only for kind file).
- F4 -> `sftpjs.go` (list returns `{path, entries}` with RealPath), `FilePanel.tsx` ("Current folder", "Up to parent folder" button, disabled at `/`; path input shows the resolved path).
- F5/F6 -> `engine/remotefiles/remotefiles.go` (unchanged logic from session 1, plus a folder target now reports "is a folder" before `ErrExists`), `FilePanel.tsx` (typed `REMOTE_FILE_EXISTS`; confirm text: permissions kept, owner and access lists not, a link is replaced and its target unchanged).
- F7 -> `sftpjs.go` (`close` via `sync.Once`: cancel, wait up to 10 s for the transfer's deferred temp removal on the live client, then `client.Close`), `engine/main.go` (`close` defers `session.Close` until `files.close()` returns when a transfer is busy; split into `finishClose`).
- F8 -> `sftpjs.go` uses `remotefiles.ClientOptions()` (concurrent reads and writes, 16 requests in flight); JS `File` reader and chunk writer feed `File.ReadFrom`/`WriteTo`; progress calls only on whole-percent change.
- F9 -> `remoteFiles.ts` `displayName` (C0, C1, U+061C, U+200E/F, U+202A-202E, U+2066-2069 shown as `<U+XXXX>`), applied to list, prompts, notices, error text, and saved file name.
- F10 -> `FilePanel.tsx` ("Stop transfer" alertdialog with "Stop and close" and "Keep transferring"), `engine.ts` (`guardSftp`, `openFiles`, `FilesClosedError`), `frontend/src/connectionErrors.ts` (closed-connection message).
- Tests -> new `engine/remotefiles/remotefiles_test.go` (13 tests), `frontend/src/components/FilePanel.test.tsx`, `frontend/src/ssh/engine.test.ts`, `frontend/src/App.test.tsx` (mocks), `frontend/e2e/connect-flow.spec.ts`, `frontend/playwright/global-setup.ts` (exports `E2E_SFTP_ROOT`).
- Docs -> `README.md` files paragraph, `frontend/src/helpTopics.ts` files topic.

### Spec coverage

| Finding | Code | Test |
| --- | --- | --- |
| F1 createWritable | FilePanel.tsx receiveFile | FilePanel.test "falls back to memory when browser storage has no createWritable" |
| F2 OPFS cleanup | FilePanel.tsx, remoteFiles.ts | FilePanel.test "keeps the stored copy until the next transfer and removes it on close", "removes the stored copy when the page is hidden", "sweeps only download copies older than ten minutes" |
| F3 symlinks | remotefiles.List, sftpjs list, FilePanel | Go TestListResolvesLinksAndPath (dir, file, broken links); FilePanel.test "labels links and opens folders through them"; e2e logs-link and broken-link |
| F4 parent and path | remotefiles.List RealPath, FilePanel Up | Go TestListResolvesLinksAndPath (`logs/..` -> `/`); FilePanel.test "goes up to the parent folder and stops at the root"; e2e Current folder and Up |
| F5 stale-listing replace | remotefiles.Upload Lstat before and after rename | Go TestUploadRefusesExistingWithoutOverwrite, TestUploadDetectsTargetCreatedDuringTransfer (OpenSSH-style generic failure); FilePanel.test "asks before replacing when the engine finds the file"; e2e Replace flow |
| F6 mode and fallback | remotefiles.Upload Chmod, Remove plus Rename | Go TestReplaceKeepsMode (0751 kept), TestReplaceSymlinkReplacesLink, TestReplaceWithoutPosixRename |
| F7 cleanup on close | sftpjs close, main.go close | Go TestCancelledUploadRemovesTemp; e2e asserts no `.localssh-upload-*` left. Disconnect-mid-upload through the real engine not tested (see Not verified) |
| F8 throughput | ClientOptions, sftpjs reader/writer | Go TestUploadDownloadLargerThanOneChunk (3 MiB + 17 B); measurement below |
| F9 bidi/control | remoteFiles.displayName | FilePanel.test "shows hostile names with bidi and control characters escaped", "keeps names without unsafe characters unchanged" |
| F10 close and release | FilePanel confirm, engine.ts guard | FilePanel.test "asks before closing during a transfer", "closes at once when no transfer runs", "reports a closed file connection instead of an empty folder"; engine.test guardSftp (3 tests) |
| Other | remotefiles | Go TestUploadEmptyFile, TestCancelledDownload, TestDownloadRejectsFolderAndFollowsLink, TestUploadRejectsFolderTarget, TestListRemovesOnlyStaleTemps |

Mutation check: disabling the post-rename `Lstat` and the `Chmod` in remotefiles.go made TestUploadDetectsTargetCreatedDuringTransfer, TestReplaceKeepsMode, and TestReplaceWithoutPosixRename fail; file restored.

### Design decisions

- Reuse: remotefiles.go from session 1 unchanged in shape; sftpjs.go is now a 310-line adapter (start/finish/busy, close, promise, reader, writer, percent reporter). HIGH confidence the Go side needs no JS to be tested.
- `awaitPromise` wraps values in `Promise.resolve`, so a non-Promise return from the page's chunk callback no longer panics. MED.
- Upload keeps reading the JS `File` 32 KiB at a time (pkg/sftp's `readFull` into one packet buffer), so memory stays bounded at about 16 packets. HIGH (read in pkg/sftp v1.13.12 client.go:1905-1945).
- Helpers moved to `frontend/src/remoteFiles.ts` because oxlint's `only-export-components` rule warns on non-component exports from FilePanel.tsx.
- `UNSAFE_DISPLAY` regex carries an `oxlint-disable-next-line no-control-regex` comment; matching controls is its purpose.
- `sweepDownloads` iterates with `keys()` through a cast because `tsconfig.app.json` lib has `DOM` without `DOM.AsyncIterable`; tsconfig left unchanged.

### F8 measurement

Engine-level, 4 MiB file, in-process test server behind a TCP proxy adding 50 ms each way (100 ms RTT), no bandwidth cap, Linux amd64 (scratch test, not committed):

```
before upload (serial 32K)   4 MiB in  13.19s =   310.4 KiB/s
before download (serial 32K) 4 MiB in  13.30s =   307.9 KiB/s
after upload (16 in flight)  4 MiB in   1.53s =  2680.9 KiB/s
after download (16 in flight) 4 MiB in   1.33s =  3089.3 KiB/s
```

About 8.6x upload and 10x download. "Before" reproduces the old loop (one 32 KiB Write or Read per round trip with concurrency off). The browser path adds one `File.slice().arrayBuffer()` per 32 KiB and the relay hop; neither was measured.

### Verification

- `go test ./...`: `Go test: 98 passed in 5 packages`
- `go test -race -count=3 ./remotefiles/`: `ok  	engine/remotefiles	2.938s`
- `GOOS=js GOARCH=wasm go vet ./...`: clean; `gofmt -l .`: clean
- `./build.sh`: `built dist/engine.wasm, dist/wasm_exec.js, dist/testsshd`
- `npm test`: `Test Files  30 passed (30)`, `Tests  329 passed (329)`
- `npx tsc -b`: no errors; `npm run lint` (oxlint): exit 0, no findings; `npm run format:check`: `All matched files use the correct format.`
- `npm run build`: `built in 169ms` (existing chunk-size advisory only)
- `npx playwright test`: `PASS (22) FAIL (0)`; the SFTP spec now covers Current folder, Up, link to folder, broken link, engine-driven Replace, and no stage file left.

### Not verified

- Close or disconnect during a running upload through the real WASM engine (F7 wait path in sftpjs.go/main.go): only compiled and vetted; the Go cancel test covers the remotefiles part. A reliable e2e needs a transfer slower than the click, which the local relay does not give.
- Safari before 26 and iOS: fallback covered by unit test with a fake OPFS, not on a device.
- Terminal latency during a concurrent transfer (512 KiB in flight on the shared connection): not measured.
- Real OpenSSH server: behavior modeled by the test server (generic failure on rename onto existing, posix-rename), not run against sshd.

### Adjacent problems (reported, not fixed)

- SUSPECTED: `write` and `resize` on a released session handle return undefined, which the page reads as success; harmless after close, but the same pattern as F10.
- Non-UTF-8 remote names arrive as U+FFFD through syscall/js; they display with the replacement character and open/download fails with "no such file". No placeholder text added.
- Broken symlinks cannot be replaced by upload on the test server, because its `path()` resolves the link target; OpenSSH not checked.
- `pagehide` also fires when a page enters the back-forward cache; returning to it leaves Save download pointing at a removed copy.
