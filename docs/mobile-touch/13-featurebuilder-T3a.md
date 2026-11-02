# T3a featurebuilder report: v2 protocol deltas with call-site adaptation

Building: the amended v2 wire format (`11` §3) in the relay codec, plus the minimal relay and `wsconn` adaptation, for the resume path. Done means the codec tests, relay tests and the resume E2E pass on the new frames.

Status: built. Not committed (lead instruction).

## Spec read and assumptions

- Source: `12` T3a entry and P-01, `11` §3, A2, A6, A7, A9, §7.
- `ready` grant/cap rule in the decoder: both are an int >= 1 or `null`. When the cap is a number, the grant must be a number no larger than the cap (`null` grant with a numeric cap is rejected). A `null` cap allows any grant, including `null`. A cap of `0` never appears in `ready` (cap 0 answers `resume_disabled`), so the decoder rejects it.
- The relay stores the granted grace on the session and uses it for the detach timer, so the `ready` value is truthful (one field, not in the plan's list; see Notes). The cap stays the fixed 120000 until T6a.
- `close` uses `revoke(session, "session_closed")`, which also sends the `session_closed` error frame to the closing socket before closing it, as the existing revoke path does.

## Built

- `relay/src/protocol.ts`:
  - `V2ErrorCode` adds `resume_disabled`, `superseded`.
  - New exported type `V2GraceMs = number | null`.
  - `connect` carries `requestedGraceMs` (safe int >= 1 or `null`; `0`, negatives, fractions, `2^53`, strings rejected).
  - `ready` is `[2,"ready",sid,token,maxUnackedBytes,grantedGraceMs,capGraceMs]`; `expiresAt` removed.
  - `resumed` carries `newToken` (64 lowercase hex).
  - New zero-field frames `close`, `ping`, `pong`. Encoder and decoder both updated; the encoder still validates through the decoder.
- `relay/src/local-relay.ts` (call sites only):
  - Grant = `min(requestedGraceMs ?? Infinity, 120000)`, stored as `session.graceMs`, sent in `ready` with cap `120000`; detach timer and `expiresAt` use `session.graceMs`.
  - `resumed` echoes the current token as `newToken` (rotation is T6c).
  - `close` frame: `revoke(session, "session_closed")`, which destroys TCP at once.
  - `ping` frame: replies `pong`. Previously any unknown frame revoked the session.
- `engine/wsconn/wsconn.go` (parser and connect only):
  - `connect` sends a fixed `requestedGraceMs = 120000` (commented that T8a replaces it).
  - `ready` parses the new 7-tuple: limit still must equal 256 KiB, grant must be an integer in 1..120000, cap is an integer >= grant or `null`. `r.expires` is no longer set from `ready` (it was already overwritten on each detach).
  - `resumed` requires the 5-tuple and a 64-char hex `newToken`, which replaces `r.token`.

## Files changed

- `relay/src/protocol.ts`
- `relay/src/protocol.test.ts`
- `relay/src/local-relay.ts`
- `relay/src/local-relay.test.ts`: 12 existing `connect` fixtures gained `requestedGraceMs: 120000` (broken by the type change, allowed by the write-set rule); 3 new tests.
- `engine/wsconn/wsconn.go`

No frontend or E2E file changed.

## Tests added

- `protocol.test.ts`:
  - Round trips: `connect` with 120000, `null` and `MAX_SAFE_INTEGER`; `ready` with equal grant/cap, grant below cap, `null`/`null`, number/`null`; `resumed` with `newToken`; `close`, `ping`, `pong`; errors `resume_disabled`, `superseded`.
  - Exact wire strings for `connect` (number and `null`), `ready` (`null`,`null`), `resumed`, `close`, `ping`, `pong`, `data`. The v1 byte-identity test is unchanged and passes.
  - Rejects: old 4-tuple `connect`; `connect` grace extra element, string, `0`, `-1`, `1.5`, `2^53`; old `ready` with `expiresAt`; `ready` missing or extra element, grant above cap, `null` grant with numeric cap, grant `0`, cap `0`, fractional grant, `maxUnackedBytes` 0; `resumed` old 4-tuple, short token, uppercase token, extra element; `close`/`ping`/`pong` with fields; `error` with an extra field; unknown error code (existing).
- `local-relay.test.ts`:
  - "grants min(requested, 120000) in ready and echoes the token in resumed": 5000 -> 5000, 3600000 -> 120000, `null` -> 120000, cap 120000, `maxUnackedBytes` 262144; `resumed` equals `{clientAck:0, serverAck:0, newToken: ready.token}`.
  - "expires a detached session at its granted grace": grant 5000, target alive at 4999 ms, destroyed at 5000 ms (fake timers).
  - "answers ping with pong and revokes the session on an explicit close frame": `pong` reply, target stays up; after `close` the target is destroyed and a later resume with the old token gets `expired`.
- Red evidence: protocol tests `18 failed | 53 passed (71)` before the codec change; relay tests `6 failed | 46 passed (52)` before the call-site change (new tests failed on the old `ready` shape, missing `pong`, 120 s timer; three existing resume tests timed out because the old `ready` no longer encoded).

## Checks (Node 26.13.0 on PATH)

- `npm test -- src/protocol.test.ts src/local-relay.test.ts` (relay): `Test Files 2 passed (2)`, `Tests 123 passed (123)`.
- V-RELAY:
  - `npm test`: `Test Files 5 passed (5)`, `Tests 139 passed (139)`.
  - `npm run build`: exit 0.
  - `npm run lint` (`oxlint src scripts test`, run with pipefail): exit 0, no output.
  - `npm run format:check`: `All matched files use the correct format.` (I ran `oxfmt` on my three relay files only.)
- V-ENGINE: `go test ./...`: all packages `ok` or `[no test files]`. `./build.sh`: exit 0, `built dist/engine.wasm, dist/wasm_exec.js, dist/testsshd`. `gofmt -l .`: no output.
- E2E `npm run test:e2e -- e2e/connect-flow.spec.ts --browser=chromium --grep "resumes one WASM" --reporter=line`: first run `1 failed`, `Error: v2 relay exited: 1`. Cause: an orphaned `tsx scripts/run-local-relay.ts 8788 --resumable` (started 08:24:54, parent reparented to PID 3310) held port 8788, so the spawned relay hit `EADDRINUSE`. No Playwright run was active. I stopped the orphan (PIDs 3144483, 3144494) and reran: `1 passed (3.9s)`. That run leaked a new orphan on 8788 (PID 3155117), which I also stopped; port 8788 is free now.

## Unverified

- WebKit run of the resume E2E (the done-when names Chromium only).
- `wsconn` has no Go unit seam under `js`; its parser changes are proven only through the Chromium resume E2E (new `ready` and 5-tuple `resumed` on a real relay).
- No test sends a `close`, `ping` or `superseded` from `wsconn`: the engine does not send or handle them yet (T8a/T8b).

## Notes for the lead

- Explains the chromium failure in `13-featurebuilder-T1.md` ("v2 relay exited: 1"). The cause is not protocol code: `connect-flow.spec.ts:9` spawns `npm run relay:local`, and `relay.kill("SIGTERM")` at `:182` signals only `npm`. The `tsx` grandchild survives and holds 8788, so the next run fails. Every run leaks one. Not fixed (outside T3a's write set). `11` §7 already assigns T8a to replace the fixed port; T8a should also kill the process group (for example `spawn(..., { detached: true })` plus `process.kill(-relay.pid)`) or spawn `tsx` directly. Until then, run `pkill -f "run-local-relay.ts 8788"` before this spec.
- Small addition beyond the listed adaptation: the relay's detach timer uses the granted grace instead of the fixed 120 s, so a short grant is honored. `11` §8 lists "per-session grace timer fires at the grant" under T6a; T6a can keep the test and add the chained timers for long grants.
- `close` sends `[2,"error","session_closed"]` to the closing page before the socket closes (existing revoke behavior). T8a's `wsconn` must ignore errors after it sent `close`.
- `wsconn` still requires `maxUnackedBytes == 256 KiB` and a grant <= 120000; T8a lifts both per `11` §7 (1).
- Test-file type checking (`tsc -p tsconfig.json`) shows older errors in `local-relay.test.ts` (Buffer and `netConnect` overload types). They predate T3a and are outside the build gate; the `requestedGraceMs` errors from my type change are fixed.
