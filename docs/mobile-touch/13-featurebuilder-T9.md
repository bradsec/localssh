# T9 featurebuilder report

Building: keepalive pause and in-flight SFTP transfer continuity for browser SSH users, done when a v2 socket loss within grace preserves the SSH session and both transfers complete byte-for-byte.

Assumption: an already outstanding SSH keepalive request may finish after detachment; no new probe starts while paused. The pause test checks ten 10 ms intervals.

## Built and files changed

- `engine/sshclient/client.go:46,162-221`: idempotent pause/resume controls stop probes, freeze misses, and restart the normal cadence with zero misses.
- `engine/main.go:147-156`: the existing v2 status callback pauses on `reconnecting` and resumes on `connected`.
- `engine/sshclient/keepalive_test.go:44-123`: adjusted the two existing fake-connection callers for the changed internal loop signature and added the pause/resume test.
- `frontend/e2e/connect-flow.spec.ts:552-704`: added a v2 relay E2E that drops the socket mid-download and mid-upload of 8 MiB, then checks SHA-256 hashes, progress order, completion, and status transitions. Its fixture files are removed after the test.
- `frontend/src/components/FilePanel.tsx:234-238`: inspected, no edit. `pagehide` releases only a completed held download.

No test fixtures, mocks, or type-only call sites changed beyond the two internal Go test callers above. The accepted dirty worktree was preserved. No branch or commit was created.

## Spec coverage

| Requirement | Commit | Test |
| --- | --- | --- |
| Idempotent keepalive pause/resume, no probes or miss-driven close while paused | None, per task instruction | `TestKeepalivesPauseAndResume` |
| Pause on reconnecting; resume on connected | None | v2 transfer E2E status and continuity checks |
| In-flight 8 MiB download and upload survive socket loss within grace | None | `v2 resumes in-flight 8 MiB SFTP transfers after socket loss` |
| Monotonic progress and byte-exact results | None | Same E2E, progress assertions and both SHA-256 comparisons |
| `FilePanel` does not abort an in-flight transfer on `pagehide` | None | Existing code inspected; no new test needed for unchanged handler |

## Design decisions

- HIGH, supported by the Go fake-connection test: `Session` owns one atomic pause flag and one buffered wake channel. The existing keepalive loop remains the only probe scheduler.
- HIGH, supported by Chromium E2E: the existing v2 transport status callback controls keepalives. SFTP continues over its existing SSH connection; no transfer protocol or dependency was added.
- Out of scope: page lifecycle wiring (T10), transfer offset resume after expiry (T13), upload offset resume (deferred T14), and transfer UI states.

## Checks and results

- Test first: `rtk go test ./sshclient -run TestKeepalivesPauseAndResume -count=1` failed as expected with `session.PauseKeepalives undefined` and `session.ResumeKeepalives undefined` before implementation.
- `rtk go test ./sshclient ./...`: `Go test: 103 passed in 5 packages`
- `rtk go test -race ./sshclient`: `Go test: 44 passed in 1 packages`
- `rtk npm run test:e2e -- e2e/connect-flow.spec.ts --browser=chromium --reporter=line`: `19 passed (52.6s)`
- `rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm run test` in `frontend/`: `Test Files  32 passed (32)`; `Tests  372 passed (372)`
- `rtk npm run test` in `relay/`: `Test Files  6 passed (6)`; `Tests  168 passed (168)`
- `rtk ./build.sh` in `engine/`: `built dist/engine.wasm, dist/wasm_exec.js, dist/testsshd`
- `rtk npm run build` in `frontend/`: `✓ built in 195ms`
- `rtk npm run build` in `relay/`: `> tsc -p tsconfig.build.json`, exit 0.
- `rtk npm run lint` in `frontend/`: `> oxlint`, exit 0.
- `rtk npm run format:check` in `frontend/`: `All matched files use the correct format.`
- `rtk git diff --check`: exit 0.

The first full Chromium run had `18 passed`, `1 failed`: my E2E fixture made the existing empty-directory assertion fail. Fixture cleanup fixed it; the full rerun passed.

## Self-review

- T9-01 | HIGH | `connect-flow.spec.ts:702` | fixture files affected a later test | removed both files in `finally`; full rerun passed.
- No change needed after that fix. The implementation leaves v1 behavior and `FilePanel` untouched.

## Unverified and notes for the lead

- Physical iPhone Safari suspension and an open OPFS writable were not tested. Chromium socket loss proves live-page continuity only.
- Expiry and page eviction are outside T9; T13 owns offset resume and recovery.
- The frontend build still warns that a JavaScript chunk exceeds 500 kB. This predates T9 and was not changed.
- Node 22 rejected `--no-webstorage`; the mandated Node 26 run passed.
