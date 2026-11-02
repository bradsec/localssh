# T13a feature builder report

Building: engine download resume by byte offset with remote-identity checks, for the T13b/T13c download-resume UI. Done means `Download` resumes from an offset with bytes identical to a full read, rejects a changed file with `ErrRemoteChanged` / `"remote file changed"`, and offset 0 behaves as before.

## Assumptions

- mtime is Unix milliseconds at the precision the server reports, the same value `List` returns (`remotefiles.go:101`). SFTP v3 carries whole seconds, so a record must store the `onStart` or `List` value, not a local clock reading. MED.
- `progress` reports absolute bytes (offset + written) out of the full size, so a resumed download's percentage continues from where it stopped. The plan does not say. MED.
- Offset 0 ignores `ExpectSize`, `ExpectMtime` and `Tail`, following the plan's "When the offset is above 0". HIGH.
- With offset > 0, an empty tail, a tail longer than the offset, a negative offset, or an offset past the remote size fails with `invalid download options`, not `ErrRemoteChanged`. Size and mtime are checked first, so a size change still reports `ErrRemoteChanged`. MED.
- A tail that the remote cannot supply (EOF) maps to `ErrRemoteChanged`.
- Tail length is the caller's choice (plan and `11` §6 say 4 KiB). The engine does not cap it, beyond requiring tail length <= offset.
- If the page's `onStart` throws, the bridge cancels the transfer before the first chunk and rejects with the callback error.
- The bridge forwards options only when the caller passes them, so an existing call still reaches the engine with exactly three arguments.

## Built and files changed

- `engine/remotefiles/remotefiles.go`: `ErrRemoteChanged`, `DownloadOptions{Offset; ExpectSize, ExpectMtime; Tail}`, new `Download(ctx, c, name, dst, opts, onStart, progress)`. Above offset 0 it runs Stat, compares size and mtime, `ReadAt`s the tail before the offset and compares it, then `Seek(offset)` and `WriteTo`. `cancelWriter` starts at `written = offset`, so the stop at the Stat size still holds.
- `engine/sftpjs.go`: `download` accepts an optional 4th argument `{offset, expectSize, expectMtime, tail: Uint8Array, onStart}`, parsed by `downloadOptions`. Numbers must be exact integers within 2^53; anything else rejects with `invalid download options`. `onStart` receives `{size, mtime}`.
- `frontend/src/ssh/engine.ts`: `REMOTE_FILE_CHANGED`, `DownloadOptions` interface, optional `opts` on `SftpHandle.download`, and `guardSftp` passes it through.
- `engine/README.md:67`: documents the new download signature (it was stale).
- Test call sites updated for the new Go signature: existing `Download(...)` calls in `engine/remotefiles/remotefiles_test.go` (lines 187, 354, 372, 382, 436) now pass `DownloadOptions{}, nil`.
- `frontend/src/components/FilePanel.tsx:127,160`: no change needed, because `opts` is optional.

## Tests added

- Go (`remotefiles_test.go`): `TestDownloadResumesFromOffset` (resume from 1 MiB of a 3 MiB+17 file equals a full read; onStart size and mtime; progress ends at size/size), `TestDownloadResumeDetectsRemoteChange` (mtime, size, tail subtests each give `ErrRemoteChanged` with text "remote file changed", 0 bytes written, onStart not called), `TestDownloadOffsetZeroIgnoresExpectations`, `TestDownloadRejectsInvalidResumeOptions` (4 cases), `TestDownloadResumeAtEndWritesNothing`.
- Frontend (`engine.test.ts`): "passes download resume options to the engine" checks pass-through, the 3-argument call without opts, and the sentinel value.
- Red first: Go failed to compile (`undefined: DownloadOptions`). The frontend test failed on the 4-argument `toHaveBeenCalledWith`.

## Spec coverage

Requirement | Code | Test
--- | --- | ---
`Download(..., opts DownloadOptions, onStart, progress) (grew, err)` | `remotefiles.go` Download | all Download tests
Above offset 0: stat, size and mtime compare, tail compare, Seek and WriteTo | `remotefiles.go` Download | `TestDownloadResumesFromOffset`, `TestDownloadResumeDetectsRemoteChange`
Mismatch returns `ErrRemoteChanged` | `remotefiles.go` | `TestDownloadResumeDetectsRemoteChange` (mtime, size, tail)
Offset 0 as today | unchanged path | existing download tests, `TestDownloadOffsetZeroIgnoresExpectations`
JS `download(path, onChunk, onProgress, opts?)` with `onStart({size, mtime})` | `sftpjs.go`, `engine.ts` | `engine.test.ts`; scratch E2E below
`REMOTE_FILE_CHANGED = "remote file changed"` | `engine.ts`, `ErrRemoteChanged` text | `engine.test.ts`, Go sentinel-text check

## Verification

- `rtk go test ./remotefiles/...` in `engine/`: `Go test: 29 passed in 1 packages`.
- V-ENGINE: `rtk go test ./...`: `Go test: 115 passed in 5 packages`. `./build.sh`: `built dist/engine.wasm, dist/wasm_exec.js, dist/testsshd`. `gofmt -l .`, `go vet ./...` and `GOOS=js GOARCH=wasm go vet .` print nothing.
- V-FE (Node 26): `rtk npm test`: `Test Files 35 passed (35)`, `Tests 439 passed (439)`. `rtk npm run build`: `built in 180ms`. Lint: `rtk proxy npx oxlint` exit 0, no output. `rtk npm run lint` printed `ESLint output (JSON parse failed ...)` and exit 1; that is the rtk wrapper failing to parse oxlint's empty output, not a lint finding. `rtk npm run format:check`: `All matched files use the correct format.`
- The first full V-FE run failed in `FilePanel.test.tsx:291`: `guardSftp` was forwarding an explicit `undefined` 4th argument. I fixed `guardSftp` to keep the 3-argument call, not by changing the fixture.
- E2E, real entry point: `connect-flow.spec.ts -g "8 MiB SFTP" --browser=chromium` gave `1 passed (6.8s)` on the rebuilt `engine.wasm`, covering offset-0 download through the bridge.
- E2E, temporary scratch spec (deleted afterwards). It downloaded a 3 MiB file through `window.sshConnect` and `openFiles().download` in chromium: `1 passed (6.5s)`. Recorded results:
  - The resume from 1 MiB returned 2097152 bytes, and their SHA-256 matched `source.subarray(1 MiB)`.
  - `onStart` received `{"size":3145728,"mtime":1793592649000}`.
  - mtime, size and tail mismatches each rejected with `"remote file changed"` after 0 bytes.
  - `offset: "x"`, `offset: 1.5` and `tail: [1,2]` (not a Uint8Array) each rejected with `"invalid download options"`.
  - A throwing `onStart` rejected with `"callbacks.call: JavaScript error: start failed"` after 0 bytes.
  - A no-opts call downloaded the full 3145728 bytes.

## Self-review

- S1 | LOW | `remotefiles.go` Download | The tail length is unbounded, so a page could ask for a large `ReadAt` buffer | no change: the page is the trusted caller, and tail length is capped by offset. Noted for T13c to send 4 KiB.
- S2 | MED | `engine.ts` guardSftp | Forwarding `undefined` changed the existing 3-argument call shape | fixed: opts are forwarded only when given.
- No debug output, dead code or unrelated edits.

## Unverified and Notes for the lead

- Not verified: webkit for the scratch E2E (only chromium ran). Behavior against servers that report mtime finer than seconds (SFTP v3 cannot carry it).
- T13b/T13c must store the `mtime` from `onStart` (or `List`), never from the local clock or `File.lastModified`.
- Adjacent, SUSPECTED: Playwright runs leave `run-local-relay.ts` processes orphaned under systemd: the global-setup relay on 8787, and the free-port v2 relay spawned by `connect-flow.spec.ts:731` via `npm run`. The next run then hits `EADDRINUSE 127.0.0.1:8787`. The 42885 relay ignored SIGTERM, and I killed both with SIGKILL. Likely cause: teardown kills the `npm`/`tsx` wrapper but not the node grandchild. Not fixed.
- No commits or branches were made.
