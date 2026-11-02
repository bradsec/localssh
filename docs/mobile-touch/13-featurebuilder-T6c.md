# T6c featurebuilder report: relay liveness, takeover, token rotation, resume-failure limit

Building: a 90 s client-silence detach, takeover on resume, two-phase token rotation and a per-address resume-failure limit in the v2 relay, for keep-alive users whose page dies or returns. Done means `npm test -- src/local-relay.test.ts` passes in `relay/` with the T6c cases.

Status: built. Not committed (lead instruction).

## Spec read and assumptions

- Source: `12` T6c entry; `11` A7, A8, A9, §4 (resume-failure row), §3 error codes.
- Takeover and the two-phase retry accept the current token or the previous one. A page whose `resumed` was lost may retry while the relay still holds its half-open socket, so the previous token can also supersede. `12` names only "the current token" for takeover. MED: same power as resuming a detached session with that token.
- Rotation on a retry with the previous token issues a fresh current token and keeps the previous one. The token from the lost `resumed` is dropped, because the page never saw it.
- "Failed resume" means a credential failure only: unknown session, wrong token or wrong origin (the `expired` answer). `offset_mismatch` is not counted; it needs a valid token and revokes the session anyway.
- "Per minute" is a fixed window per address that opens at its first failure and is deleted 60 s later by an unref'd timer. A sliding minute can therefore see up to 39 failures across two windows. LOW: `11` §4 says the limit only curbs noise.
- At the limit the relay closes with `1008 "too many failed resumes"` and sends no v2 error frame, since `11` §3 defines no code for it. It logs once per window when an address reaches the limit (address only).
- The silence timer starts when the socket is bound to the session (connect frame or successful resume) and resets on every v2 frame that reaches the session handler, including frames that then revoke.

## Built (`relay/src/local-relay.ts`)

- `CLIENT_SILENCE_MS = 90_000`: per attached socket, `bindV2` arms an unref'd timer. On expiry it detaches the session (only if that socket is still the attachment, which starts grace) and calls `ws.terminate()`. The socket's `close` clears the timer.
- Takeover: a valid `resume` while attached sends `error superseded` to the old socket, closes it, and attaches the new one. The old socket's later `close` and messages are ignored (`session.attached !== ws`).
- Rotation: `RelaySession.previousToken`. A successful resume generates a fresh 32-byte token and sends it in `resumed`. The first frame on the new attachment clears `previousToken`.
- Resume-failure limit: `resumeFailures` map keyed on `request.socket.remoteAddress`, checked before `sessions.get`. `X-Forwarded-For` is not read; `describeClient` still uses it for log text only.
- The T6 second-attach `session_closed` branch is removed.

## Files changed

- `relay/src/local-relay.ts`
- `relay/src/local-relay.test.ts`

Fixtures changed because rotation broke them (write-set rule):
- "grants min(requested, 120000) in ready and echoes the token in resumed" became "... rotates the token in resumed": it now asserts a fresh 64-hex `newToken` that differs from the `ready` token.
- "replays server bytes after transport loss until the consumer ACKs them": the third resume uses the `newToken` from the second resume instead of the original `ready` token.
- The `it.todo` placeholder for the takeover test is removed. The test now exists (below).

## Tests added (`describe("liveness, takeover, rotation and resume limit")`, nested in the T6a block to reuse its helpers)

- 90 s of silence: the socket is open at 89 999 ms and not at 90 000 ms. The 5 s grace then starts: the target is alive at +4 999 ms and destroyed at +5 000 ms. This proves detach, not revoke.
- Reset: data, ack and ping frames sent 60 s apart (180 s total) each keep the socket open. The socket then closes exactly 90 s after the ping, and grace starts. The client saw `["ack","pong"]`.
- Takeover: the old socket receives `{"type":"error","code":"superseded"}` and closes. The new socket gets `resumed` and answers ping. One target and one relay client remain. The token is not in the log.
- Rotation: resume with T0 gives T1, then the socket dies before sending anything. A retry with T0 succeeds and gives T2. After one ping on that attachment, T0 and T1 both get `expired` and T2 resumes. All three tokens are distinct and none is in the log.
- Limit: 20 bad-token resumes each get `expired`. The 21st, carrying the valid token, closes 1008 with no frame, so the check runs before lookup. After 60 s of fake time the valid token resumes. The log names the limit and holds no token.

Red evidence: before the code change the file run reported `Tests  6 failed | 59 passed (65)`: the five new tests plus the rotation fixture. Mutation checks after green, each restored afterwards. Each produced 1 or 2 named failures:
- no silence reset on frames
- previous token never dropped
- previous token not accepted
- previous token never set
- no rotation
- no limit
- no `superseded` frame

Test notes: the timing tests turn on fake timers (`setTimeout`, `clearTimeout`, `Date` only) before connecting, so the relay's timers are fake. They wait on real `setImmediate` polling and server-side `message` listeners, not `vi.waitFor`. Under fake timers `vi.waitFor` advances fake time and shifted the 90 s boundary.

## Checks (Node 26.13.0 on PATH, in `relay/`)

- Done-when, `rtk npm test -- src/local-relay.test.ts`: `Test Files  1 passed (1)`, `Tests  65 passed (65)`. Five consecutive runs gave the same result before the last cleanup.
- V-RELAY:
  - `rtk npm test`: `Test Files  5 passed (5)`, `Tests  152 passed (152)`.
  - `rtk npm run build`: exit 0.
  - `rtk npm run lint`: exit 0.
  - `rtk npm run format:check`: `All matched files use the correct format.` (I ran `oxfmt` on my two files only.)
- Extra, because rotation changes what `wsconn` receives: in `frontend/`, `rtk npm run test:e2e -- e2e/connect-flow.spec.ts --browser=chromium --grep "resumes one WASM" --reporter=line` gave `1 passed (4.1s)`. `wsconn.go:715-726` already adopts `newToken`.

## Unverified

- Real Node timers over 90 s; only fake timers were used.
- WebKit E2E: not run, and not in the done-when.
- Behind nginx every client shares one `remoteAddress`, so the limit is global there (`12` F-02, accepted).
- Takeover of a half-open old socket: `close()` waits for `ws`'s close timeout before destroying it. Until then the old socket still counts in `wss.clients` for `admitConnect`. Not tested.

## Notes for the lead

- T8a/T8b: map `superseded` to Session expired (`11` T-03). A close with 1008 `too many failed resumes` arrives without a v2 error frame. The page must send its first frame (ping or data) promptly after `resumed`, because that frame ends the old token's validity.
- T11 docs: effective hold can reach the choice plus 90 s (A7).
- Orphan relay, still open (T3a and T6a notes): the E2E left `tsx scripts/run-local-relay.ts 8788 --resumable` running again. I stopped it with `pkill -f "run-local-relay[.]ts 8788"`; port 8788 is free.
- Security review F-01/T-06 (rotation and takeover) is now unblocked.
