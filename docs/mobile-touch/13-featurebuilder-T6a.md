# T6a featurebuilder report: relay grant, cap, close, capacity, byte accounting

Building: a per-session v2 grace grant clamped by an operator cap, plus capacity eviction, full detached-byte accounting and TCP keep-alive in the relay, for the keep-alive feature. Done means `npm test -- src/local-relay.test.ts` passes with the T6a cases.

Status: built. Not committed (lead instruction).

## Spec read and assumptions

- Source: `12` T6a entry, P-03, A-05; `11` A3, A6, A10, A11, A12, §4, §8.
- `maxGraceMs` must be a safe integer >= 0 or `null`; anything else throws at start, like the other numeric options.
- `resume_disabled` answers any valid v2 first frame while the cap is 0, `resume` included (not only `connect`). After a relay restart with the cap set to 0, that names the real cause. An invalid v2 frame still closes 1002, as before.
- Capacity: a connect evicts only as many detached sessions as it needs. When evicting every detached session would still not make room, the relay refuses with 1013 and evicts nothing.
- Admission now runs after the target allowlist check (it ran before it). A disallowed target can then never evict another user's session. Side effect: a disallowed connect at capacity now closes 1008 instead of 1013.
- Close (`12` lists "close" in the title): the T3a close frame already revokes at once. T6a adds no close code; the grant-matrix test uses it to end each session.

## Built

`relay/src/local-relay.ts`:
- `DETACH_GRACE_MS` removed. `LocalRelayOptions.resumableSessions` replaced by `maxGraceMs?: number | null`, default `0` (v2 off).
- Grant = `min(requested ?? Infinity, cap ?? Infinity)`; `Infinity` is stored and sent as `null`. `ready` carries the real cap.
- Detach timer: `armExpiry` re-arms in steps of at most 2^31-1 ms, counting the remainder down without reading the clock. A `null` grant arms no timer. `RelaySession.expiresAt` and the resume-time clock check are gone; the timer revokes at expiry.
- `admitConnect()` serves v1 and v2 connects: open sockets plus detached sessions count against `maxSessions`, and the oldest detached sessions are revoked (`retention_exceeded`) to make room. The v1-only handshake 503 (v2 off) is unchanged.
- The 16 MiB detached budget sums retained output, `clientHistory` and `pendingClientBytes` per session.
- `target.setKeepAlive(true, 60_000)` on v2 target sockets only. v1 is unchanged.
- First-frame routing: a `[2,` frame is decoded first; with v2 off, the relay answers `error resume_disabled` and closes.

## Files changed

- `relay/src/local-relay.ts`
- `relay/src/local-relay.test.ts`
- `relay/scripts/run-local-relay.ts` (type-only call site: `--resumable` maps to `maxGraceMs: 3_600_000`, else `0`, until T11)

Fixtures changed because of my type change (write-set rule): 14 `resumableSessions: true` options in `local-relay.test.ts` became `maxGraceMs: 120_000`, which keeps their old 120 s cap. The T6 test "retains a v2 target across detach and permits one same-origin resume" lost two parts. (1) `maxSessions: 1` and the "blocked connect gets 1013" step: A10 now evicts the detached session there. The new capacity test covers that path. (2) The duplicate-resume `session_closed` assertion became `it.todo("a resume while attached supersedes the old socket (T6c takeover)")`, as the plan directs. The relay code still rejects a second attach with `session_closed` until T6c.

## Tests added (`describe("local relay grant, cap and capacity")`)

- Grant matrix: requests 120000, 300000, 600000, 900000, 3600000 and `null` against caps 300000, 3600000 and `null`. Each `ready` carries `min` and the cap; `null`/`null` stays `null`.
- `resume_disabled` for `connect` and `resume` with the default options and with `maxGraceMs: 0`; no target is dialed.
- An invalid `maxGraceMs` (`-1`, `1.5`, `NaN`, `Infinity`) throws.
- A 30-day grant (above 2^31-1 ms) survives 1 ms and 30 days minus 1 ms, and expires at 30 days. Vitest fake timers clamp like Node (`node_modules/vitest/dist/chunks/index.aTZaPVhf.js:4935`, `timer.delay > maxTimeout ? 1`), so the test catches the regression.
- Two unlimited sessions survive 10 simulated hours. A third connect at `maxSessions: 2` evicts the oldest, and `closeLocalRelay` destroys the rest.
- Capacity: a v1 connect evicts the oldest detached v2 session, whose resume then gets `expired`. A v2 connect evicts the next. With every session attached, both v1 and v2 connects close 1013 and nothing else is evicted.
- Budget: each detached session holds 256 KiB retained, 256 KiB history and 256 KiB pending (target `write` stubbed so it never completes). 21 sessions fit and the 22nd evicts only the oldest. This holds only when all three buffers count.
- `setKeepAlive(true, 60000)` is called on the v2 target and not on the v1 target.

Red evidence: before the code change the file run reported 22 failures. They were the new tests plus the existing v2 tests whose fixtures had moved to `maxGraceMs`: the old relay ignored the option and closed every v2 frame with 1002, so those tests timed out. Mutation checks after green, each restored afterwards: dropping history from the budget, dropping pending input from it, removing timer chunking, and removing `setKeepAlive` each produced `Tests  1 failed | 59 passed | 1 todo (61)`, with the matching test named.

## Checks (Node 26.13.0 on PATH, in `relay/`)

- Done-when, `npm test -- src/local-relay.test.ts`: `Test Files  1 passed (1)`, `Tests  60 passed | 1 todo (61)`.
- V-RELAY:
  - `npm test`: `Test Files  5 passed (5)`, `Tests  147 passed | 1 todo (148)`.
  - `npm run build`: exit 0.
  - `npm run lint` (`oxlint src scripts test`): exit 0, no findings.
  - `npm run format:check`: `All matched files use the correct format.` (I ran `oxfmt` on my three files only.)
- Extra, because `run-local-relay.ts` changed: in `frontend/`, `npm run test:e2e -- e2e/connect-flow.spec.ts --browser=chromium --grep "resumes one WASM" --reporter=line` gave `1 passed (4.2s)`. `wsconn` accepts the new cap 3600000 with its fixed 120000 request.

## Unverified

- WebKit E2E: not run, and not in the done-when.
- The 2^31-1 chunking runs on Vitest fake timers, which emulate Node's clamp, not on real Node timers over 25 days.
- Admission counts `wss.clients`, which includes sockets that have not sent their first frame and resume sockets, as the old formula did. No test covers a pre-frame socket holding capacity.

## Notes for the lead

- Orphan relay, still open (T3a note): the E2E again left `tsx scripts/run-local-relay.ts 8788 --resumable` running (PIDs 3159188, 3159199). I stopped it, and 8788 is free. Also, `pkill -f "run-local-relay.ts 8788"` as written in the T3a note matches the shell that runs it and kills it (exit 144). Use `pkill -f "run-local-relay[.]ts 8788"`.
- T6c: the `it.todo` marks the takeover rewrite. The second-attach `session_closed` branch in `handleV2` is still live.
- T6b and T11: `maxGraceMs` (number or `null`, `0` = off) is the policy value that `handleCapabilities` and `parseKeepaliveMaxGraceMs` should pass through. `startLocalRelay` validates only the range; T11 owns the 2147483 s env bound and `unlimited`.
- At cap 0 a v2 frame now gets `resume_disabled` rather than a bare 1002 close. T8a's `wsconn` can map it to a clear error (`11` §7 (8)).
