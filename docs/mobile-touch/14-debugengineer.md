# Debug engineer report

Date: 2026-11-02. Environment: Linux 6.12.113+deb13-amd64 x86_64, Node v26.13.0, Go 1.26.4, Playwright 1.64.1, Vitest 5.0.5. No deploy or upgrade date was supplied. The worktree contained accepted uncommitted Phase 2 changes at entry. They were preserved. No branch or commit was made, as requested. Current HEAD is `ddacf09`; there is no fix commit.

## Bug 1: target refusal shown as relay failure

**Symptom and reproduction.** Expected alert: `The server refused the connection.` Actual alert: `Could not reach the relay.` with technical detail `could not reach the relay: it may be down, or it refused this page's origin (check ALLOWED_ORIGINS in the relay configuration, and the relay log for the reason)`. Connect to `127.0.0.1:1` through the default resumable transport. Run `E2E_RELAY_PORT=8788 npm run test:e2e -- e2e/help.spec.ts -g 'explains a refused connection and links to the matching Help topic' --reporter=line` from `frontend/` with Node 26. Port 8787 was already held by a process outside the sandbox PID namespace, so the first unmodified run failed during global setup with `local relay failed: listen EADDRINUSE: address already in use 127.0.0.1:8787`. The configurable test port allowed the exact reported symptom to reproduce.

| ID | Hypothesis | Evidence for | Evidence against | Decision test and result |
| --- | --- | --- | --- | --- |
| B1-H1 | HIGH: the v2 WASM dial discards a pre-ready WebSocket close reason | Relay closes target errors with a reason at `relay/src/local-relay.ts:465-467`; old v2 close handler returned `errWebSocketConnect` at `engine/wsconn/wsconn.go:637` | None after focused repro | Strengthened e2e assertion for `relay connection closed: target connection refused` failed before the fix and passed after it. Confirmed. |
| B1-H2 | LOW: the frontend maps the correct raw refusal to the wrong copy | The alert copy was wrong | `frontend/src/connectionErrors.ts:150` maps `target connection refused` to `refused`; its unit case already passes | Raw technical detail lacked the target refusal. Ruled out. |
| B1-H3 | LOW: the relay does not label target refusal | The target dial fails before a v2 ready frame | `relay/src/local-relay.ts:465-467` calls `targetFailureReason`; relay tests cover refusal mapping | The returned error changed by preserving the close event, with no relay change. Ruled out. |

**Causal chain.** Trigger: v2 connects to an unlistened TCP port (`relay/src/local-relay.ts:403-437`). Fault: relay closes the WebSocket with code 1011 and `target connection refused`, while the v2 dial dropped that reason before its ready frame (`relay/src/local-relay.ts:465-467`, `engine/wsconn/wsconn.go:637-642`). Propagation: `engine/main.go:149-180` rejects with the generic WebSocket error. Observed failure: `frontend/src/connectionErrors.ts:152` selects the relay-unreachable alert.

**Fix and regression proof.** `engine/wsconn/wsconn.go:637-642` now returns `CloseError` for a pre-ready close with a reason, retaining the generic error for an empty reason. `frontend/e2e/help.spec.ts:60-74` now asserts the specific technical detail before the alert copy. The new v1 control at `frontend/e2e/help.spec.ts:77-87` verifies that the older transport still reports target refusal. The strengthened v2 assertion failed before the Go edit with `Expected substring: "relay connection closed: target connection refused"` and `Received string: "Could not reach the relay...Technical detailscould not reach the relay: it may be down..."`. After the edit: `1 passed (5.3s)`. The full suite also passed the v1 control. This is a regression from the uncommitted v2 resume path.

**Sibling checks.** The v1 close handler already preserves close reason (`engine/wsconn/wsconn.go:175-184`). The same v2 close fix carries target timeout, DNS failure, and target-not-allowed reasons into existing frontend mappings (`frontend/src/connectionErrors.ts:148-151`). An origin rejection occurs at WebSocket upgrade and has no browser-visible reason, so the generic relay message remains expected (`relay/src/local-relay.ts:595-623`). B1-S1 | MED, SUSPECTED | `relay/src/local-relay.ts:403-405`, `frontend/src/connectionErrors.ts:162` | A v2 session-limit close now reaches the frontend as `relay connection closed: relay session limit reached`, which appears to map to `connection-lost` rather than the relay-limit recovery copy | Add a dedicated mapping after reproducing that path. This was reported, not changed.

## Bug 2: parent-folder unit test flake

**Symptom and reproduction.** Expected initial breadcrumb `tester`; actual `Home` in approximately half of the reported `npm test` runs. The focused command `npm test -- src/components/FilePanel.test.tsx -t 'goes up to the parent folder and stops at the root'` failed before editing with `Expected: tester` and `Received: Home` at `frontend/src/components/FilePanel.test.tsx:286`.

| ID | Hypothesis | Evidence for | Evidence against | Decision test and result |
| --- | --- | --- | --- | --- |
| B2-H1 | HIGH: the test reads the already-rendered navigation before initial async listing finishes | `findByRole` can return on the initial `Home` navigation; `opened.list(".")` updates the path later at `frontend/src/components/FilePanel.tsx:391-408` | None after failure trace | Wait for breadcrumb text `tester`; ten consecutive full-file runs passed. Confirmed. |
| B2-H2 | LOW: product navigation races after the Up click | The test is intermittent | Failure happened at the first assertion, before any click | Ruled out. |

**Causal chain.** Trigger: the test renders FilePanel. Fault: its navigation query completes before the initial listing resolves (`frontend/src/components/FilePanel.test.tsx:285-290`). Propagation: the assertion reads the initial `Home` breadcrumb. Observed failure: `Expected: tester`, `Received: Home`.

**Fix and regression proof.** `frontend/src/components/FilePanel.test.tsx:286-290` waits until the initial breadcrumb contains `tester`. Product code was not changed. The observed failure occurred before the edit. Afterward, ten consecutive full-file runs each returned `Test Files 1 passed (1)` and `Tests 47 passed (47)`. This is a test synchronization defect in the accepted worktree, not a proven product defect.

**Sibling checks.** No other FilePanel navigation assertion was shown to race. No sibling change was made.

## Bug 3: e2e relay child processes survive teardown

**Symptom and reproduction.** Existing `tsx scripts/run-local-relay.ts <port>` processes survived test runs; one occupied 127.0.0.1:8787 and blocked the initial focused e2e run with `EADDRINUSE`. A disposable reproduction of the affected `npm` spawn/`relay.kill("SIGTERM")` pattern returned `port=36395 npm_exit=null relay_listener_survived=true` after npm exited.

| ID | Hypothesis | Evidence for | Evidence against | Decision test and result |
| --- | --- | --- | --- | --- |
| B3-H1 | HIGH: two specs kill npm but leave its spawned relay | The affected specs spawned `npm run relay:local`; the disposable probe found its listener alive after npm exited | None after probe | Process-group cleanup returned `port=42753 relay_listener_survived=false`; targeted e2e passed. Confirmed. |
| B3-H2 | LOW: Playwright skips returned global-setup cleanup | The default port was occupied | The installed Playwright 1.64.1 code runs returned cleanup; `frontend/playwright/global-setup.ts:119-136` owns and stops its direct relay child | The focused and full runs closed their selected setup port. Ruled out for runs observed here. |
| B3-H3 | LOW: test SSH server survives global teardown | Prior process reports mentioned `testsshd` | `frontend/playwright/global-setup.ts:119-136` stops its direct sshd child; no new listener remained after full e2e | No process identity was available for pre-existing host listeners. Unconfirmed, not changed. |

**Causal chain.** Trigger: the two v2 tests in `frontend/e2e/connect-flow.spec.ts:168` and `frontend/e2e/connect-flow.spec.ts:723` spawn `npm run relay:local`. Fault: their former `relay.kill` targeted npm only. Propagation: npm's `tsx` child outlived the test. Observed failure: relay listener survived and later test setup could hit `EADDRINUSE`.

**Fix and regression proof.** Both affected spawns use detached process groups and both `finally` blocks kill those groups (`frontend/e2e/connect-flow.spec.ts:184,719,744,874`). `E2E_RELAY_PORT` now selects the setup port and the built app's relay URL (`frontend/playwright/global-setup.ts:112,172-180`, `frontend/playwright.config.ts:13`); `frontend/README.md:67-68` documents it. Two opt-in WebSocket rewrites use the selected base port. The post-fix disposable probe returned `port=42753 relay_listener_survived=false`. Targeted e2e returned `2 passed (33.9s)`. The full e2e run returned `47 passed (1.5m)`. After both runs, the listener list matched its pre-run list; the disposable port 18787 was closed. This is a regression in the accepted uncommitted e2e specs.

**Sibling checks.** Two other phone tests already use detached process groups and group cleanup (`frontend/e2e/connect-flow.spec.ts:106,163,1419,1482`). The setup relay uses a direct child, not npm (`frontend/playwright/global-setup.ts:172-180`). B3-S1 | LOW, SUSPECTED | `frontend/e2e/connect-flow.spec.ts:719,874` | `process.kill` could throw if a relay group has already exited before `finally`; no observed failure | Check only if a test demonstrates that exit order.

## Verification and limits

All commands ran with Node 26 in PATH where applicable. Recorded output:

| Check | Baseline | Final |
| --- | --- | --- |
| Focused v2 refusal e2e | `1 failed`, expected refusal, received relay-unreachable | `1 passed (5.3s)` |
| FilePanel focused repro | `Expected: tester` / `Received: Home` | Ten consecutive full-file runs: each `Tests 47 passed (47)` |
| Full frontend e2e, all configured projects | No clean baseline: 8787 was already occupied | `47 passed (1.5m)` |
| Frontend unit tests | No full baseline captured before the focused test fix | `Test Files 39 passed (39)` / `Tests 523 passed (523)` |
| Frontend typecheck | Not run before fixes | `TypeScript: No errors found` |
| Frontend lint | Not run before fixes | `> oxlint`, exit 0 |
| Frontend format check | Not run before fixes | `All matched files use the correct format.`, exit 0 |
| Relay tests | `Test Files 7 passed (7)` / `Tests 184 passed (184)` | `Test Files 7 passed (7)` / `Tests 184 passed (184)` |
| Engine Go tests | `Go test: 125 passed in 5 packages` | `Go test: 125 passed in 5 packages` |
| Whitespace check | Not run before fixes | `git diff --check`, exit 0 |

The full e2e run left no **new listening port**. The port 18787 listener closed. Listeners on 8787, 42917, and 46129 were present before this work and remained afterward. Their owners are outside this sandbox PID namespace, so process identity and a host-wide claim that no relay or `testsshd` process remains could not be verified. No host process was killed. Other OS/browser combinations, production data, and load conditions were not tested. No current external library claim was needed: Playwright behavior was checked against installed 1.64.1 source, and relay and engine behavior against local code.

## Notes for the lead

Only the three reported bugs were changed. The accepted Phase 2 edits remain in the dirty worktree. There is no fix commit by instruction. B1-S1 is the main follow-up risk: v2 session-limit copy likely needs a separate repro and mapping. The original 8787 listener still blocks unconfigured e2e runs on this host; use the documented `E2E_RELAY_PORT` override until its owner is identified.
