# T8a feature builder report

## Spec read and assumptions

Building: the WASM v2 transport contract for browser SSH users, done when chosen grace, v1 Off, token rotation, explicit close and close errors work through the real relay.

- Assumption: `keepAliveMs` absent selects v1; `null` requests Until I disconnect. The relay can still grant its finite cap.
- Assumption: T8b owns heartbeat, exponential backoff and ACK coalescing. T8a keeps the existing retry and ACK behavior.
- No branch or commit was made, per the task instruction. The accepted uncommitted work remains in place.

## Built and files changed

- `engine/wsconn/wsconn.go`: accepts the chosen grace, parses the amended `ready`, sizes pending and received buffers from `maxUnackedBytes`, stores the rotated token, maps new relay errors, and sends `close`. A detached close reattaches before revoking.
- `engine/main.go`: validates `keepAliveMs`, passes grant and cap to `onTransportStatus`, and reports asynchronous session close errors through `onClose`.
- `frontend/src/ssh/engine.ts`: replaces `resumable` with optional `keepAliveMs` and types the status details.
- `frontend/src/ssh/engine.test.ts`: new type boundary test. This is a test file added under the write-set allowance.
- `frontend/e2e/connect-flow.spec.ts`: uses a free relay port; checks v1 framing, grace requests and grants, exact echo, rotation, takeover, active and detached close revocation, and Chromium-only CDP scope.

## Coverage

Requirement | Commit | Test
--- | --- | ---
Absent `keepAliveMs` uses v1 | none, instructed | `a keepAliveMs-absent connect uses v1 frames`
Requested and granted grace, including `null` | none, instructed | `passes the chosen grace and transport status details to WASM`; `resumes one WASM SSH session with each echoed byte exactly once`
Bounded v2 buffers, resume, rotated token | none, instructed | `resumes one WASM SSH session with each echoed byte exactly once`
Explicit active and detached close revokes | none, instructed | `resumes one WASM SSH session with each echoed byte exactly once`
Takeover and `superseded` | none, instructed | `resumes one WASM SSH session with each echoed byte exactly once`
Chromium-only CDP throttle | none, instructed | `lists the first 10,000 items of a larger folder and reaches the end`
Asynchronous close error via `onClose` | none, instructed | Not directly exercised; `offset_mismatch` E2E covers a transport close reason

## Design decisions and self-review

- HIGH: `Dial` remains the v1 path; the E2E recorder observed only its existing JSON connect frames and binary SSH data.
- HIGH: `ready.maxUnackedBytes` sets both buffer caps; the relay protocol already limits it to 256 KiB.
- HIGH: `resumed` replaces the token before subsequent sends; E2E observed rotation and takeover.
- MED: detached explicit close resumes once, then sends `close`; E2E proved the old token gets `expired`.
- SR-01 | HIGH | `engine/wsconn/wsconn.go:1003` | Detached explicit close initially left the relay session alive. Fixed with a bounded reattach and verified by the failing-then-passing E2E case.
- No other change needed in the focused diff.

## Checks and results

- Initial red test: `src/ssh/engine.test.ts` failed with `expected undefined to be null` before the boundary change.
- Detached-close red test: `page.evaluate: Error: detached session remained resumable after close` before the close fix.
- `rtk go test ./...`: `Go test: 102 passed in 5 packages`.
- `rtk ./build.sh`: `built dist/engine.wasm, dist/wasm_exec.js, dist/testsshd`.
- `rtk npm test`: `Test Files  32 passed (32)`; `Tests  372 passed (372)`.
- `rtk npm run build`: `✓ built in 675ms`.
- `rtk npm run lint`: exit 0, no findings.
- `rtk npm run format:check`: `All matched files use the correct format.`
- `rtk npm run test:e2e -- e2e/connect-flow.spec.ts --browser=chromium --reporter=line`: `18 passed (24.1s)`.
- `rtk git diff --check`: exit 0, no findings.

## Unverified and notes for the lead

- WebKit and physical iPhone behavior were not run. T8a's mandated browser gate is Chromium.
- A concurrent automatic retry and explicit close was not forced in E2E. The detached-close case covers a deliberate detach without a retry already in flight.
- A `session.Close()` error was not induced through the real SSH server. The E2E covers a relay error passed to `onClose`, not this specific error branch.
- T8b owns heartbeat, backoff and ACK coalescing. T9 and T10 own keepalive pause and page lifecycle integration. No dependency, README or API documentation change was needed for this transport-only task.
- Existing Vite build reports a chunk larger than 500 kB. This is adjacent to T8a and was not changed.
