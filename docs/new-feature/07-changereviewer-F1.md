# F1 change review: SFTP browse, upload, download

## 1. Change and intent

Range 79f1ed8..HEAD (a9fcf87), 23 files, +1308/-22. Change: add a per-tab SFTP file panel (pkg/sftp v1.13.12 over the existing SSH client in the WASM engine; list, upload via temp file plus rename, streaming download) so a connected user can move single files to and from the device. Intent stated in the F1 stub (docs/new-feature/01-featurescout.md:106-125). Builder report has no coverage table or self-review (lead note), so the coverage check is below.

## 2. Verdict

CHANGES REQUIRED (confidence MED). Decided by F1 and F2 (both MED, no data loss, but each breaks a stated requirement or a realistic mobile path). Nothing CRITICAL or HIGH found.

## 3. Findings

F1 | MEDIUM | frontend/src/components/FilePanel.tsx:27-28 | `handle.createWritable()` sits outside the try block that cleans up, and its failure skips the 16 MiB fallback. | Safari/iOS before 26 (createWritable on OPFS lands in Safari 26 per MDN compat data via search, secondhand; unverified against Apple notes) or any browser where getDirectory works but createWritable is missing/throws: download throws, temp file `localssh-download-<uuid>` stays in OPFS forever (no startup sweep). | Feature-detect `createWritable` and fall through to the bounded Blob path; move createWritable inside the try; add a startup sweep removing `localssh-download-*`. | MED
F2 | MEDIUM | frontend/src/components/FilePanel.tsx:23-47 | OPFS temp copy removed only by a 10-minute `setTimeout`. | Reload, tab close, or navigation within 10 minutes of a download leaves the full-size file in origin storage; repeated large downloads fill quota. | Sweep stale `localssh-download-*` entries on panel mount; also remove on `pagehide`. | HIGH
F3 | MEDIUM | engine/sftpjs.go:162-166 (list), FilePanel.tsx:256-263 | List uses ReadDir (lstat), so a symlink to a directory has `isDir=false`. It shows as a file with a Download button; download then fails with "not a regular file" (sftpjs.go:287). Spec item 2 asks for type. | Remote `/var/www`-style or `~/logs -> /data/logs` symlink in the listing. | Report `isSymlink`; resolve with `Stat` to set `isDir`; show type (file, folder, link, other). | HIGH
F4 | MEDIUM | FilePanel.tsx:116-119, sftpjs.go:162 | No parent navigation and no resolved path. ReadDir omits `..`; panel shows `.` and only the typed path. User cannot go up except by typing a path and does not see where they are. | Open Files (path "."), enter a subfolder, want to go back. Product standard: easy to navigate. | Add an "Up" control and show `client.RealPath(".")` result. | HIGH
F5 | MEDIUM | FilePanel.tsx:135-136, 200-201 | Overwrite fallback regex matches only "file exists"/SSH_FX_FILE_ALREADY_EXISTS. OpenSSH sftp-server answers a rename onto an existing file with SSH_FX_FAILURE (it stats the target after link() fails with EEXIST; from memory of sftp-server.c process_rename, not re-verified). The only guard is the client-side `entries.some(...)` check against a possibly stale listing. | File created on the server (by the terminal) after listing, then upload with same name: shows "Transfer ... stopped: sftp: Failure" instead of the Replace prompt. No silent overwrite occurs (good). The e2e/test server is pkg/sftp, not OpenSSH, so this is untested. | Before upload, `Stat` the target in the engine (or `list` fresh) and return a typed "exists" error. | LOW
F6 | MEDIUM | engine/sftpjs.go:240-258 | Confirmed overwrite uses PosixRename of a new temp file: the replaced file loses its mode, owner, and ACLs; a symlink at the target is replaced, not followed. A deploy script `0755` becomes `0644`. Also fails on servers lacking `posix-rename@openssh.com` with no fallback. | Replace an executable remote file. | Copy the old mode via Stat/Chmod on the temp before rename; warn in the confirm text; fallback message for missing extension. | MED
F7 | MEDIUM | engine/sftpjs.go:196, 90-96 | Disconnect during upload: `close()` cancels then closes the client, so the deferred `Remove(temp)` runs on a closed client and fails silently. Reload/tab close mid-upload also leaves it. Leaves `.localssh-upload-<hex>` partial file in the target directory. Help text hedges ("when the server permits cleanup") but does not cover this. | Upload a large file, drop the connection or close the tab. | Accept and document explicitly, or have close() wait for the active transfer's cleanup before closing the client (bounded timeout). Manual-cancel path is fine. | HIGH
F8 | MEDIUM | engine/sftpjs.go:215-230, 41-49 (UseConcurrentWrites(false)) | Upload is strictly serial: 32 KiB chunk, one `arrayBuffer()` await, one acknowledged write per chunk. Throughput is about 32 KiB per RTT (about 320 KB/s at 100 ms mobile RTT); a 100 MB file takes about 5 minutes. Download likewise, with a JS promise await per chunk. | Mobile link, files over a few MB. Memory is bounded (good). | Use larger chunks (128-256 KiB) or enable concurrent writes with a bounded window. | MED
F9 | LOW | FilePanel.tsx:253-264, 229 | Remote names render as plain text (React-escaped, no XSS) and become `link.download`. Names are not neutralised for bidi override (U+202E) or control characters, so a name like `report‮gpj.exe` displays spoofed. Browsers sanitise `/` and `\` in download names; SFTP names cannot contain `/`. Non-UTF-8 names are lossy through syscall/js, so open/download of them returns "no such file". | Hostile or odd filenames on the server. | Strip or visibly escape bidi and control code points for display; show a placeholder for non-UTF-8 names. | MED
F10 | LOW | FilePanel.tsx:92-117 | Unmounting the panel (Close files) calls `client.close()`, which cancels a running transfer with no warning. Also, a click racing `files.close()` (engine/sftpjs.go:97-106 releases the js.Func) calls a released func; `files.list` then returns undefined and `setEntries(undefined)` would throw at `entries.length`. Narrow window. | Close panel or disconnect during a transfer; click in the gap before React unmounts. | Confirm before closing during a transfer; guard `Array.isArray` on list result. | LOW
F11 | LOW | engine/sftpjs.go:160-170 | Directory with 100k entries is built and rendered fully, no paging or virtualisation. | Large `/var/log` or maildir. | Cap with a "showing first N" note or virtualise. | LOW
F12 | LOW | FilePanel.tsx:119-134, 177 | Download timer capture: a second download replaces `downloadLink` but the first URL stays valid for 10 minutes, and `Save download` anchors to the OPFS-backed blob. Fine functionally; noted for F2. Not a separate defect. | n/a | none | LOW

## Spec coverage (F1 stub requirements)

1. SFTP over existing verified connection: MET. `b.session.Client()` opens a subsystem channel; no relay change (engine/sftpjs.go:121). Frozen items (relay protocol, host-key checks, vault) untouched in the diff.
2. List name/type/size, show permission and transport failures: PARTIAL. Name, size, dir/file shown; symlink/other type wrong (F3). Permission and not-found errors mapped (connectionErrors.ts, tested in e2e for no such file).
3. Upload/download without whole file in memory: MET for upload (32 KiB slices) and for download where OPFS createWritable works. PARTIAL elsewhere: fallback buffers up to 16 MiB then errors (documented in help); Safari path broken (F1).
4. Confirm before replace, never silent overwrite or delete: MET in UI (stale listing: F5); upload goes to a temp then rename, so a failed or cancelled upload keeps the old file. Quality of replace: F6. Delete not offered.
5. Closing SFTP keeps terminal; disconnect closes both and cancels transfers: MET (sessionBridge.close in engine/main.go:301-310; e2e types into terminal after Close files). Temp cleanup on disconnect: F7.
Per-tab isolation: MET. `fileTabs` keyed by tab id, sessionBridge/sftpBridge per tab, one transfer at a time per tab (`start()` at sftpjs.go:61-72), tab close and onClose delete the entry (App.tsx). App.test.tsx covers two tabs.
Backpressure against terminal: SFTP uses its own channel on the shared connection; chunk-by-chunk awaiting bounds memory and cannot starve the terminal channel beyond shared-window contention. No test measures terminal latency during a transfer (not verified).

## 4. Callers and siblings checked

`sessionBridge.close` and `handle()` (engine/main.go); `SshHandle.openFiles` optional so existing mocks hold; App.tsx tab close/onClose paths; sibling download path for `Stat` regular-file check; testserver SFTP jail (root and symlink escape test present). `TestServer.EnableSFTP` is in non-test file `engine/sshclient/testserver.go`, and the wasm already links pkg/sftp via sftpjs.go (3 sftp-related deps); the test server was already compiled into the package before this change, so no new exposure, but wasm size is 9.3 MB (no baseline measured).
Dependency: pkg/sftp v1.13.12 confirmed on proxy.golang.org, published 2026-10-23. GitHub advisories API returned 404 for the repo, so no advisory check was possible (unverified).

## 5. Check results

Not re-run; lead reported all green at HEAD (engine tests, wasm vet, build.sh, frontend 314 tests, tsc, lint, format, build, Playwright 22 passed). I read the new engine and e2e tests: no test covers symlinks, cancel on the engine side, stale-listing overwrite, disconnect mid-transfer cleanup, the OPFS-unavailable fallback, or files over one chunk (32 KiB). Only the Go SFTP server is exercised, not OpenSSH.

## 6. Not reviewed or not verified

Real-OpenSSH behaviour for rename-onto-existing (F5) and Safari createWritable version (F1): from memory and a secondary search, not primary docs. Real-device throughput (F8) not measured. Styling in app.css skimmed only. testserver.go SFTP internals skimmed.

Route fixes to the change author.
