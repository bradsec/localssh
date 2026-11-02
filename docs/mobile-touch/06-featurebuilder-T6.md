# T6: Relay session ownership and bounded retention

Building: opt-in v2 relay session retention for browser SSH users; done means a detached transport can reattach to its live TCP target during a bounded grace period, while v1 keeps its close behavior.

## Built

- `relay/src/local-relay.ts:108`: `resumableSessions?: boolean` defaults to `false`. V1 handling remains the default.
- `relay/src/local-relay.ts:221`: v2 `connect` creates a 16-byte random session ID and 32-byte random bearer token. Resume checks the original Origin, token, detached state, and deadline. One WebSocket attaches at a time. Tokens stay out of URLs and logs.
- `relay/src/local-relay.ts:199`: detached sessions retain TCP for 120 seconds and count toward `maxSessions`. The relay caps unacknowledged bytes at 256 KiB per direction and detached retained output at 16 MiB. It pauses target reads at the per-session cap and revokes the oldest detached session under global pressure.
- `relay/src/local-relay.ts:335`: explicit detach rejects subsequent frames from the old transport. Target close, grace expiry, relay shutdown, and explicit v2 error revoke sessions and destroy target sockets.
- `relay/src/local-relay.test.ts:21`: eight tests cover v1 close, detach/resume, token and Origin rejection, one attachment, capacity, expiry, both byte caps, oldest-session eviction, target close, stale frames, shutdown cleanup, and token absence from captured logs. Tests use the injected `targetConnector` where target socket state matters.

## Design and assumptions

- `local-relay.ts` | modified | owns v2 sessions beside the existing v1 path | reuses the T3 frame codec, existing origin and target policy, and Node TCP sockets. Confidence HIGH for the tested lifecycle.
- First v2 frame -> validate target -> dial TCP -> `ready`; transport close or `detach` -> grace timer; `resume` -> token, Origin, state, deadline checks -> reattach. Confidence HIGH for the tested path.
- The `ready.expiresAt` value starts at creation; the relay renews the actual grace deadline on detach. T7 must reconcile that advertised value with replay and subsequent detach cycles. Confidence MED, because the protocol plan does not define a live-session renewal frame.
- T7 owns complete ordered delivery, ACK validation, and replay. T6 retains bounded server bytes and tracks pending client writes, but does not claim lossless recovery yet. Confidence HIGH from the task split.
- No new package, public rollout setting, frontend change, or documentation change. T11 owns rollout docs.
- No branch or commit was created, as requested. Other builders' files were left untouched.

## Test-first and review

- Initial red run: `rtk npm test -- src/local-relay.test.ts` exited 1, `Tests  1 failed | 37 passed (38)`, because v2 never sent `ready`.
- Review finding `T6-01 | MED | relay/src/local-relay.ts:337 | queued data after detach reached TCP | guard frames by current attachment`; the focused test failed with `expected 'late' to be ''`, then passed after the guard.
- No remaining self-review finding in T6's lifecycle scope. Byte replay remains T7 work.

## Verification

Run from `relay/` after final formatting:

```text
rtk npm test -- src/local-relay.test.ts
Test Files  1 passed (1)
      Tests  45 passed (45)

rtk npm test
Test Files  5 passed (5)
      Tests  100 passed (100)

rtk npm run build
> tsc -p tsconfig.build.json

rtk npm run lint
> oxlint src scripts test

rtk npm run format:check
All matched files use the correct format.
```

All listed commands exited 0. `rtk git diff --check` exited 0.

## Unverified and notes for the lead

- End-to-end browser/WASM resume is unverified because T7 and T8 have not supplied replay and a resumable `wsconn` yet.
- A production SSH target's pause and timeout behavior is unverified. The local TCP tests prove relay backpressure, not server-specific survival.
- T7 should use retained server chunks for replay, check both resume ACK offsets, and settle `ready.expiresAt` renewal. The current v2 data path is a bounded lifecycle seam, not a complete ordered transport.
