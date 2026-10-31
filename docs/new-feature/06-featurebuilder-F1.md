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
