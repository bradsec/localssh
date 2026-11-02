# T8b featurebuilder report

Building: WASM transport liveness, increasing resume backoff, coalesced server ACKs, and terminal takeover handling for keep-alive users. Done means a live v2 session pings, retries at increasing intervals after a drop, and reports takeover as expired without retrying.

## Spec read and assumptions

- Source: `12-implementationplanner-amended.md` T8b; `11-solutionarchitect-amendment.md` A7 to A9, §3, §7. Approved lead decisions apply.
- Ambiguity: whether the 90 s silence deadline requires a one-shot timer or a periodic check. Assumption: check every 10 s, reaching the threshold at 90 s under normal timer scheduling. Confidence MED; suspended browsers may delay callbacks.
- Ambiguity: how to create a 1 MiB output burst against the test SSH server, which only echoes input. Assumption: write 1 MiB of `x` through the real WASM handle and measure echoed data and ACK frames. Confidence HIGH; `testserver.go:147-165` echoes shell input.
- The accepted worktree was dirty on arrival. T8a content in both write-set files was preserved. No branch or commit was created, as the final task instruction requires.

## Built and files changed

| File | Change |
| --- | --- |
| `engine/wsconn/wsconn.go:498` | Track relay frame time, last sent ACK, ACK timer, and retry reset signal. |
| `engine/wsconn/wsconn.go:621` | Count every relay frame as liveness; accept `pong`. |
| `engine/wsconn/wsconn.go:834` | Send `ping` each 20 s while attached; close a silent socket at the 90 s check so the existing close path resumes it. |
| `engine/wsconn/wsconn.go:865` | Send server ACK after 32 KiB or 50 ms of reads; acknowledge read bytes on resume. |
| `engine/wsconn/wsconn.go:893` | Retry from 500 ms, doubling to 30 s; try once even after the local grace deadline; reset on `Resume()`. |
| `frontend/e2e/connect-flow.spec.ts:7` | Extend the existing socket recorder and WASM test for ping, 1 MiB ACK coalescing, live WASM takeover, and retry timing. |

No fixtures, mocks, type-only call sites, dependencies, or public interfaces changed. No README, config, or API reference became stale from this internal transport change.

## Spec coverage

| Requirement | Commit | Test |
| --- | --- | --- |
| 20 s attached ping | none, instructed | `connect-flow.spec.ts:178`, actual v2 frame recorded |
| 90 s relay-frame silence closes and resumes | none, instructed | Mechanism in `wsconn.go:834`; no 90 s browser clock test |
| 500 ms doubling backoff, 30 s cap | none, instructed | `connect-flow.spec.ts:450-513` proves growing intervals; cap not timed end-to-end |
| One attempt after an elapsed local deadline | none, instructed | `connect-flow.spec.ts:520-545` detaches a 100 ms session, waits 300 ms, then records a resume frame |
| `Resume()` resets backoff | none, instructed | Recorder triggers `Resume()` during failed retries; no separate reset-timing assertion |
| ACK at 32 KiB or 50 ms | none, instructed | `connect-flow.spec.ts:183-207`, 1 MiB echo has fewer than half as many ACKs as data frames |
| `superseded` expires without retry | none, instructed | `connect-flow.spec.ts:394-453`, raw second socket takes over a live WASM session, its close reason contains `superseded`, and 700 ms brings no retry |

## Design decisions

- `resumeState` heartbeat goroutine | modified `wsconn.go` | uses the existing v2 socket and `done` channel | no new transport layer. Confidence HIGH.
- `time.AfterFunc` ACK flush | modified `wsconn.go` | shares the state mutex and batches reads | bounded to one timer per session. Confidence HIGH.
- Existing `retry()` loop | modified `wsconn.go` | changes only delay and local-deadline handling | preserves v2 offset replay. Confidence HIGH.
- Existing E2E socket recorder | modified `connect-flow.spec.ts` | observes real WASM frames and forces a drop | no production test hook. Confidence HIGH.

Out of scope: T9 keepalive pause and transfer continuity; T10 page lifecycle; UI, settings, and operator docs.

## Test-first and verification evidence

- Red test before implementation: Chromium failed at `connect-flow.spec.ts:169`: `Expected: true`, `Received: false`, `Timeout 5000ms exceeded` for the missing ping.
- `rtk go test ./... && rtk ./build.sh` in `engine/`: `Go test: 102 passed in 5 packages`; `built dist/engine.wasm, dist/wasm_exec.js, dist/testsshd`.
- `rtk npm test` in `frontend/`: `Test Files  32 passed (32)`; `Tests  372 passed (372)`.
- `rtk npm run test:e2e -- e2e/connect-flow.spec.ts --browser=chromium --reporter=line` in `frontend/`: `18 passed (50.6s)`. This ran the app, WASM engine, SSH test server, and v2 relay.
- `rtk npm run build` in `frontend/`: `✓ built in 198ms`.
- `rtk npm run lint` in `frontend/`: exit 0, `> oxlint`.
- `rtk npm run format:check` in `frontend/`: `All matched files use the correct format.`
- `rtk npm test` in `relay/`: `Test Files  6 passed (6)`; `Tests  168 passed (168)`.
- `rtk npm run build`, `rtk npm run lint`, and `rtk npm run format:check` in `relay/`: exit 0; `All matched files use the correct format.`
- `rtk git diff --check`: exit 0, no output.

Node 26.13.0 was used for frontend commands because the project requires Node 26. The final E2E run used the final engine build.

## Self-review

- T8b-01 | MED | `wsconn.go:834` | A 20 s tick would first notice 90 s silence at about 100 s | changed to a 10 s check while retaining 20 s pings.
- T8b-02 | MED | `wsconn.go:1080` | A queued reset could skip the first backoff on a later retry | queue reset only while retry is active.
- T8b-03 | LOW | `connect-flow.spec.ts:450` | Global resume-frame counts included older sessions and made timing assertions unreliable | capture a baseline before the forced drop.
- Remaining reviewed diff: no change needed. No debug output, new abstraction, or known v1 behavior change.

## Unverified and notes for the lead

- The 90 s silence path, 30 s backoff ceiling, and reset timing were not clock-driven end-to-end. The Chromium test proves the normal 20 s ping, increasing early retry intervals, an attempt after the local deadline, and takeover error path. Device timer throttling remains unverified.
- WebKit and physical iPhone background behavior were not run. T9 and T10 own transfer and page lifecycle checks.
- SUSPECTED adjacent issue: a suspended browser may delay the 10 s timer, so the local 90 s detection may occur later. Relay T6c has its own 90 s client-silence timer. No change outside T8b.
- The existing Vite warning reports a JavaScript chunk above 500 kB. This predates T8b and was not changed.
