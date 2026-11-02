# Amended implementation plan: remaining mobile touch work

Building: user-chosen SSH keep-alive with relay resume, recovery and transfer resume, a Settings dialog with line height, the revised phone key bar, and matching docs, for browser SSH users on iPhone Safari and desktop. Done means a terminal set to 2 min survives a short app switch on the same SSH session. After that time it offers one-tap Reconnect. An interrupted download resumes by offset. Settings, key bar and docs match `10`/`11`.

> For featurebuilder: take one task at a time, in the ORDER line at the end. Tasks run one after another; none run in parallel. Read `10`, `11`, `08` and this file first. `05` is superseded wherever this file differs. Write the named failing test first. Do not commit unless the lead asks. A task may also edit test fixtures, mocks and type-only call sites that its own type change breaks. Name them in the report.

## 1. Spec read, decisions, assumptions

Inputs: `05` (base plan), `08` (Settings), `10` (UI revision, approved), `11` (architecture amendment, approved), the `06` reports, `07`. Lead decisions are fixed (prompt of this step). `10` and `11` amend `02`, `03`, `05` and `08`.

State found in the worktree (2026-11-02, `git status`, `git diff --stat`):

- Built and kept: T2 (`terminalSnapshot.ts`), T3 (v2 codecs, `relay/src/protocol.ts`), T4 (Select text view), T5 (phone switcher, `DESIGN.md` delta), T6/T7 (relay v2 sessions and replay, `relay/src/local-relay.ts`), and the 07 fixes (`KeyBar.tsx:69,86` pointer-up; two-session E2E).
- T8 is half-applied and has no report: `engine/wsconn/wsconn.go` (+540), `engine/main.go`, `frontend/src/ssh/engine.ts`, `relay/scripts/run-local-relay.ts`, and the resume E2E at `frontend/e2e/connect-flow.spec.ts:6`. `11` §7 governs how it is finished.
- **T9 is not built**, although the lead's brief lists it as built. `06-featurebuilder-T9.md` reports "Code files changed: none", and `git status` shows no change under `engine/sshclient/`. This plan treats T9 as remaining work (task T9). Confidence HIGH.
- T1 was never built.

Ambiguities, one line each (question | assumption taken):

- A-01 | Does the all-in-one default count as "ALLOWED_ORIGINS=*"? When the variable is unset, `run-all-in-one.ts:24` supplies `*` and `:30` turns on same-origin Host checks. | No. The resume-off exception applies only when the operator's raw environment value is literally `*`, in either script. The unset all-in-one default is same-origin mode, so resume is on by default there. MED. Docs must state both cases.
- A-02 | Where is the capability endpoint, given that the standalone relay sits behind the nginx prefix `/relay` (`deploy/nginx.conf:16`) and a directly configured relay URL has no prefix? | The page derives `http(s)://<relay ws host><relay ws path>/capabilities` from `RELAY_WS_URL`. The relay answers a GET whose pathname is `/capabilities` or ends in `/capabilities`. MED.
- A-03 | Does the recovery row (`10` S-15) apply on desktop? | No. `10` B-04 says "On touch". Desktop keeps the current lost-session handling. MED.
- A-04 | How does an engine API compare the tail bytes for download resume (`11` §6)? | The engine compares them: the page passes the local tail, and the engine rejects with a sentinel when it differs. That keeps the check in Go, where a test seam exists (`engine/remotefiles/remotefiles_test.go`). MED.
- A-05 | Library default for the relay's new option? | `startLocalRelay` defaults `maxGraceMs` to `0` (v1 only), the same opt-in shape as today's `resumableSessions = false` (`local-relay.ts:172`). The 3600 s operator default lives in the shared env parser (T11). HIGH: existing relay tests stay valid.
- A-06 | How is the keep-alive choice stored? | `keepAlive: "off" | 120 | 300 | 600 | 900 | 3600 | "until-disconnect"`, with default `120`. "off" maps to v1, a number to `requestedGraceMs = n*1000`, and "until-disconnect" to `null`. HIGH (from `11` A1/A2).

Conventions (from project files and builder reports):

- Node 26 is required (`frontend/package.json:7`, `.nvmrc`). Builders hit `node: bad option: --no-webstorage` under the default Node 22 and fixed it with `rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH <cmd>` (`06-featurebuilder-T2.md`). Every npm command below assumes Node 26 on PATH.
- Gates, run from the package directory:
  - **V-FE** = `rtk npm test && rtk npm run build && rtk npm run lint && rtk npm run format:check` in `frontend/`.
  - **V-RELAY** = `rtk npm test && rtk npm run build && rtk npm run lint && rtk npm run format:check` in `relay/`.
  - **V-ENGINE** = `rtk go test ./... && ./build.sh` in `engine/`. `build.sh` does the `GOOS=js` build of `engine.wasm` and `testsshd`.
- E2E runs `rtk npm run test:e2e -- <spec> --browser=<chromium|webkit> --reporter=line` in `frontend/`. Global setup builds the engine (`frontend/playwright/global-setup.ts:144`) and starts a v1 relay on 8787 (`:171`). If port 4173 is busy, stop the stale preview first (`06-featurebuilder-T5.md`). Do not change the config.
- Tests: Vitest with jsdom, Testing Library, and `fake-indexeddb` (`frontend/package.json:45`); Go `testing`; Playwright. Lint is `oxlint`, format is `oxfmt`.

Version-sensitive facts checked:

- Node timers: a `setTimeout` delay above 2147483647 ms becomes 1 ms ([Node.js v26.13.0 timers](https://nodejs.org/api/timers.html), accessed 2026-11-02). That affects `unlimited` and large grants; see T6a.
- `FileSystemFileHandle.createWritable` arrives in Safari and iOS Safari 26 ([MDN browser-compat-data, api/FileSystemFileHandle.json](https://github.com/mdn/browser-compat-data/blob/main/api/FileSystemFileHandle.json), accessed 2026-11-02). Older Safari keeps the 16 MiB in-memory path (`FilePanel.tsx:121-123`). This closes `11` F-A4.

## 2. Coverage

Requirement (source) | Tasks
--- | ---
R1 Line height: default 1.15, 1.0 to 2.0, step 0.05, persisted, applied live (lead) | T1, T12a
R2 Settings dialog replaces Appearance, Terminal section, preview, save result (`08` S-01 to S-09) | T12a
R3 Keep-alive choice of 7 options, default 2 min, applies to new terminals, K-01 to K-07 (`08`, lead) | T12b, T10
R4 Operator cap `KEEPALIVE_MAX_SECONDS` (default 3600, `0` = v1, `unlimited`); wildcard exception (lead, `11` A3) | T6a, T11
R5 Capability endpoint and A5 v2 gating (`11` A4, A5) | T6b, T12b, T10
R6 Protocol deltas: connect grace, ready shape, resumed token, close, ping/pong, new errors (`11` §3) | T3a
R7 Off = v1 path exactly (`11` A1) | T8a, T10
R8 Explicit close revokes (`11` A6) | T3a, T6a, T8a
R9 Heartbeat 20 s / 90 s (`11` A7) | T6c, T8b
R10 Takeover and two-phase token rotation (`11` A8, A9) | T6c, T8a, T8b
R11 Capacity eviction, full byte accounting, `setKeepAlive`, resume-failure limit (`11` A10 to A12, §4) | T6a, T6c
R12 Client backoff, ACK coalescing, `maxUnackedBytes` sizing (`11` §7) | T8a, T8b
R13 Keepalive pause while detached; transfers continue within grace (`11` A14, T9) | T9
R14 Detach on `pagehide` only; resume on `pageshow`/visible/`online` (`11` T10) | T10
R15 Resuming status, recovery row, cause text, Select text on a closed tab (`10` S-13 to S-15, B-04 to B-06) | T18a
R16 One-tap Reconnect: vault credentials only when the vault is unlocked, else the connect form prefilled with host, port and user; marker line (lead, `10` S-16 to S-19) | T18b
R17 Download resume after expiry or eviction; X-01 to X-08 (`11` A15, `10` 4.7) | T13a, T13b, T13c, T13d
R18 Key bar: fit to width, More keys, `⇧tab`, Text keys, K-02 order, modifiers as items (`10` P-2, P-3, P-6, B-01 to B-03) | T15a, T15b
R19 Key bar editor in Settings (`10` 4.6) | T12c
R20 Short-landscape combined row (`10` L-10, S-21) | T17
R21 Per-host terminal settings in the vault (`10` P-5, H-01 to H-05) | T16a, T16b
R22 Docs: README, USER-GUIDE, Help, deployment env vars, `DESIGN.md` delta (lead, `08`, `10` §9) | T19a, T19b (Help strings are first touched in T12a and T12b)
R23 Upload offset resume (`11` A16, T14) | Deferred by `11` §9. No task here.

No requirement lacks a task.

## 3. Tasks in execution order (sequential)

### T1 | Persistent line-height preference | blocked by: none

Files:
- modified: `frontend/src/storage/settingsStore.ts:4` (interface), `:12` (defaults), `:28-49` (validation)
- modified: `frontend/src/storage/settingsStore.test.ts:7`
- modified: `frontend/src/components/Terminal.tsx:38` (props), `:98` (hard-coded `lineHeight: 1.15`)
- modified: `frontend/src/App.tsx:706-713`, `:730-752` (both `<Terminal>` sites)
- modified: `frontend/src/components/TerminalSettings.tsx:57` (add a select after Font size)
- modified: `frontend/src/components/toolbarLabels.test.tsx:8` (fixture)
- modified: `frontend/e2e/font-metrics.spec.ts:10`

Interfaces:
- `TerminalSettings.lineHeight: number`. `loadTerminalSettings()` accepts finite values in [1.0, 2.0] snapped to a 0.05 step, else `1.15`.
- `TerminalProps.lineHeight: number`. A change sets `term.options.lineHeight` and refits, using the same path as the font-size change (`Terminal.tsx:176-194`). It does not rebuild xterm and keeps the existing uncommitted font fix.
- Picker options run `1.00` to `2.00`, labeled with two decimals.

Test first:
- Store: old JSON without the field gives 1.15; `NaN`, `0.9`, `2.5`, `"1.2"` and off-step values are rejected; `1.35` round-trips.
- E2E in `font-metrics.spec.ts`: while connected, choose 1.50; the `.xterm-rows` row height grows and the PTY rows shrink (read from the `resize` call); reload keeps 1.50; the delayed-font regression still passes.

Done when: `rtk npm test -- src/storage/settingsStore.test.ts` and `rtk npm run test:e2e -- e2e/font-metrics.spec.ts --browser=webkit --reporter=line` pass. Live and reloaded row heights match the choice.

Verify: V-FE.

### T3a | v2 protocol deltas with call-site adaptation | blocked by: none

Files:
- modified: `relay/src/protocol.ts:64-125` (error union, `V2Frame`, decoder) and `relay/src/protocol.test.ts`
- modified, call sites only: `relay/src/local-relay.ts:332,360` (ready encode) and the resume handler, plus `relay/src/local-relay.test.ts` fixtures
- modified, parser only: `engine/wsconn/wsconn.go:692` (ready check) and the `resumed` parse

Interfaces, wire per `11` §3:
- `connect`: `[2,"connect",host,port,requestedGraceMs]`, where the grace is an int in 1..2^53-1 or `null`; `0` is invalid.
- `ready`: `[2,"ready",sid,token,maxUnackedBytes,grantedGraceMs,capGraceMs]`, with grant and cap as int or `null`. `expiresAt` is removed.
- `resumed`: `[2,"resumed",clientAck,serverAck,newToken]`.
- New frames `[2,"close"]`, `[2,"ping"]`, `[2,"pong"]`. New error codes `resume_disabled` and `superseded`.
- Minimal relay adaptation:
  - `ready` sends grant = `min(requested ?? Infinity, 120000)` and cap `120000`. The real cap arrives in T6a.
  - `close` revokes at once (`revoke(session,"session_closed")` plus TCP destroy).
  - `resumed` echoes the current token. Rotation arrives in T6c.
  - `ping` is answered with `pong`.
- `wsconn` adaptation: parse the new `ready` and accept a grant up to 120000 for now. Send `requestedGraceMs = 120000` (T8a makes it real). Accept the 5-tuple `resumed`.

Test first: in `protocol.test.ts`, v1 fixtures stay byte-identical. Round trips for the new and changed frames. Rejects: `connect` grace `0`, `-1`, `1.5`, `2^53`; `ready` with a grant above the cap; a bad `newToken`; extra or missing tuple elements; unknown error codes.

Done when:
- `rtk npm test -- src/protocol.test.ts src/local-relay.test.ts` passes in `relay/`.
- `rtk npm run test:e2e -- e2e/connect-flow.spec.ts --browser=chromium --grep "resumes one WASM" --reporter=line` passes in `frontend/`. The existing resume proof stays green.

Verify: V-RELAY, V-ENGINE.

### T6a | Relay grant, cap, close, capacity, byte accounting | blocked by: T3a

Files:
- modified: `relay/src/local-relay.ts:27` (`DETACH_GRACE_MS` removed), `:78-115` (options), `:199-225` (detach timer), `:476` (capacity check)
- modified: `relay/src/local-relay.test.ts`
- type-only call site: `relay/scripts/run-local-relay.ts:4,15` (`--resumable` maps to `maxGraceMs: 3_600_000` until T11)

Interfaces:
- `LocalRelayOptions.maxGraceMs?: number | null`, replacing `resumableSessions`. `0` (the default) disables v2, and a v2 connect then gets `error resume_disabled`. `null` means unlimited.
- Grant = `min(requested, cap)`, with `null` treated as infinity. It is fixed per session and sent in `ready`.
- The detach timer re-arms in chunks of at most 2^31-1 ms (Node clamps longer delays to 1 ms). A `null` grant schedules no timer.
- Active and detached sessions both count against `maxSessions`, for v1 and v2. At capacity a new connect revokes the oldest detached session (`retention_exceeded`) and is refused only when every session is attached.
- The 16 MiB detached budget counts retained output, client history and pending input.
- `setKeepAlive(true, 60_000)` on v2 target sockets.

Test first, Vitest with fake timers:
- The grant for each of the 6 numeric choices against caps 300 s, 3600 s and `null`; `null` with a `null` cap stays unlimited.
- Cap `0` answers `resume_disabled`.
- A grant of 30 days does not expire after 1 ms (timer clamp regression).
- An unlimited session survives 10 simulated hours, then is revoked by shutdown and by capacity pressure.
- Capacity eviction for v1 and v2 connects.
- Budget across all three buffers.
- `setKeepAlive` is called (spy via `targetConnector`).
- Rewrite T6's "one attachment" rejection test as the takeover test in T6c, not here; mark it `todo` here with a reference to T6c.

Done when: `rtk npm test -- src/local-relay.test.ts` passes in `relay/`.

Verify: V-RELAY.

### T6c | Relay liveness, takeover, token rotation, resume-failure limit | blocked by: T6a

Files: modified `relay/src/local-relay.ts` (v2 handler `:265`, resume path) and `relay/src/local-relay.test.ts`.

Interfaces:
- Per attached socket, 90 s without any client frame terminates the socket and detaches it. `ping` gets `pong`; any frame resets the timer.
- A `resume` with the current token while attached sends `error superseded` to the old socket, closes it, and attaches the new one.
- `resumed` carries a fresh 32-byte token. The previous token stays valid until the first client frame on the new attachment.
- At most 20 failed resumes per `request.socket.remoteAddress` per minute; the relay closes before session lookup. Do not key on `X-Forwarded-For`, which is untrusted (`local-relay.ts:124-133`).

Test first:
- Silence detach at 90 s, with data, ack and ping each resetting it.
- Takeover: the old socket receives `superseded`, and exactly one attachment remains.
- Rotation: a lost `resumed` still allows one retry with the old token, which fails after the first frame on the new attachment.
- The 21st bad resume within a minute is closed without lookup.
- No token appears in captured logs.

Done when: `rtk npm test -- src/local-relay.test.ts` passes.

Verify: V-RELAY.

### T6b | Capability endpoint, standalone and all-in-one | blocked by: T6a

Files:
- new: `relay/src/capabilities.ts`, `relay/src/capabilities.test.ts`
- modified: `relay/src/local-relay.ts:476-480` (when `server` is absent, create an internal `http.Server` with the handler and give it to `ws`); `closeLocalRelay` (`local-relay.ts:621`) closes that server
- modified: `relay/src/web-server.ts:20` and `relay/src/web-server.test.ts`
- call site: `relay/scripts/run-all-in-one.ts:16`

Interfaces:
- `handleCapabilities(req, res, policy: { maxGraceMs: number | null; accessConfig?: RelayAccessConfig; sameOrigin: boolean }): boolean`.
  - It handles a GET whose pathname is `/capabilities` or ends in `/capabilities`.
  - Body: `{"protocols":[1,2],"resume":boolean,"maxGraceMs":int|null}`, with `Cache-Control: no-store`.
  - CORS echoes the origin only if `assertOriginAllowed` accepts it. Same-origin mode adds no CORS header. The loopback relay without `accessConfig` echoes the origin, matching its WebSocket policy (`local-relay.ts:481`).
  - Any other method on that path gets 405.
- `createWebHandler(root, options?: { capabilities?: CapabilityPolicy })` routes the path before the static and `/relay` 404 logic (`web-server.ts:52`).

Test first:
- JSON shape for caps `0`, `3600000` and `null`.
- Allowlisted origin echoed, an unknown origin gets no header, wildcard, same-origin.
- POST gets 405.
- A standalone relay on a random port answers both `/capabilities` and `/relay/capabilities` and still upgrades WebSockets.
- `closeLocalRelay` frees the port.

Done when: `rtk npm test -- src/capabilities.test.ts src/web-server.test.ts src/local-relay.test.ts` passes.

Verify: V-RELAY.

### T8a | Finish WASM transport, part 1: contract | blocked by: T6c

Files:
- modified: `engine/wsconn/wsconn.go:24` (cap constant), `:495` (`DialResumable`), `:692`, `:958` (`close`)
- modified: `engine/main.go:133-144`, `:262-266`
- modified: `frontend/src/ssh/engine.ts:114-118`, `:206-236`
- modified: `frontend/e2e/connect-flow.spec.ts:6-220`, plus the large-folder test that calls Chromium-only `newCDPSession` (07 R-01)

Interfaces:
- `DialResumable(ctx, wsURL, host, port string, requestedGraceMs *int64, status func(string))`.
- `ConnectOptions.keepAliveMs?: number | null`, replacing `resumable`. Absent means the v1 `Dial`; `null` means until disconnect.
- `onTransportStatus(status: "connected" | "reconnecting" | "expired", info?: { grantedGraceMs: number | null; capGraceMs: number | null })`. `info` comes with the first `connected`.
- Received and pending caps are sized from `ready.maxUnackedBytes`. A `null` grant keeps no local deadline.
- `resumeState.close()` sends `[2,"close"]`, then closes the socket.
- Store `newToken` from `resumed` and use only it after the first frame.
- Map `superseded`, `resume_disabled` and `expired` to `CloseError` text.
- `main.go` reports asynchronous close errors through `onClose` and no longer drops them (`11` §7).

Test first, E2E in `connect-flow.spec.ts`:
- Replace fixed port 8788 with a free port from `net.createServer().listen(0)`.
- The existing echo-marker exactness check stays.
- New: explicit `handle.close()` frees the relay session at once, asserted via relay stdout or a second connect at `MAX_SESSIONS=1`.
- New: a `keepAliveMs`-absent connect sends only v1 binary frames, checked through the spec's socket recorder.
- Scope the CDP throttle test with `test.skip(browserName !== "chromium")`, a Chromium-only API, not a weakened assertion.

Done when: `rtk go test ./...` and `./build.sh` pass in `engine/`. `rtk npm run test:e2e -- e2e/connect-flow.spec.ts --browser=chromium --reporter=line` passes.

Verify: V-ENGINE, V-FE.

### T8b | Finish WASM transport, part 2: liveness and backoff | blocked by: T8a

Files: modified `engine/wsconn/wsconn.go:790` (`retry`), the read path near `:735` (ACK), and `frontend/e2e/connect-flow.spec.ts`.

Interfaces:
- A 20 s `ping` while attached. After 90 s with no relay frame, close and resume.
- `retry()` backs off from 0.5 s, doubling to a 30 s ceiling. It makes at least one attempt after `Resume()` even when the local deadline has passed. A `Resume()` call resets the backoff (the page calls it on return, T10).
- Coalesce server ACKs: every 32 KiB or 50 ms, whichever comes first.
- `superseded` ends the session with a clear error and no retry loop.

Test first, E2E:
- Takeover: a second page context resumes with the captured token, and the first page reports `expired` with a "superseded" reason. Use the spec's existing socket-capture hook; do not add a production test hook.
- A relay frame recorder shows ping frames and far fewer ACK frames than data frames on a 1 MiB output burst.
- After a forced drop, the retry schedule grows and is not fixed at 300 ms.

Done when: `rtk npm run test:e2e -- e2e/connect-flow.spec.ts --browser=chromium --reporter=line` passes, and V-ENGINE passes.

### T9 | Keepalive pause and transfer continuity within grace | blocked by: T8b

Files:
- modified: `engine/sshclient/client.go:154-159` (`runKeepalives` start and loop)
- modified: `engine/sshclient/keepalive_test.go:11`
- modified: `engine/main.go:133-144` (wrap the status callback)
- modified: `frontend/e2e/connect-flow.spec.ts:259` area

Interfaces:
- `func (s *Session) PauseKeepalives()` and `ResumeKeepalives()`, idempotent. While paused there are no probes and the miss count does not grow; resume restarts at the normal cadence with a zero miss count.
- `main.go` calls pause on `reconnecting` and resume on `connected`.
- `FilePanel` aborts nothing on `pagehide` (`FilePanel.tsx:234` releases only the finished held copy; keep it).

Test first:
- Go fake-conn test: no probes for 10 intervals while paused, and none of the misses close the conn; probes resume after `ResumeKeepalives`.
- E2E with a spawned v2 relay: drop the socket mid-download of an 8 MiB file and mid-upload. After resume, the downloaded hash equals the source, the uploaded remote file hash matches, and progress is monotonic.

Done when: `rtk go test ./sshclient ./...` passes, and the connect-flow chromium E2E passes.

Verify: V-ENGINE.

### T11 | `KEEPALIVE_MAX_SECONDS` configuration and wiring | blocked by: T6b

Files:
- new: `relay/src/keepalive-config.ts`, `relay/src/keepalive-config.test.ts`
- modified: `relay/scripts/run-relay.ts:33`, `relay/scripts/run-all-in-one.ts:26`, `relay/scripts/run-local-relay.ts:1-15` (drop `--resumable`)
- modified: `compose.yaml` (relay `environment`), `.env.example:18` area
- call site: `frontend/e2e/connect-flow.spec.ts` (spawn with env instead of the flag)

Interfaces:
- `parseKeepaliveMaxGraceMs(env: Record<string, string | undefined>): number | null` returns ms; `0` means disabled.
- Rules:
  - Unset or empty with the raw `ALLOWED_ORIGINS === "*"`: `0`.
  - Otherwise unset or empty: `3_600_000`.
  - `unlimited`: `null`.
  - An integer from `0` to `2147483` s: n*1000.
  - Anything else throws with the variable name. The run scripts exit with code 1 and log `invalid KEEPALIVE_MAX_SECONDS`.
- Compose passes `KEEPALIVE_MAX_SECONDS: ${KEEPALIVE_MAX_SECONDS:-}`. An empty string counts as unset.
- `run-all-in-one` reads the raw `process.env.ALLOWED_ORIGINS` before applying its own `*` default (A-01).

Test first: a parser table covering unset, empty, `*` with unset, `*` with an explicit `600`, `unlimited`, `0`, `2147484`, `-1`, `1.5` and `abc`. A script smoke test via the existing relay test style: the capabilities response reflects the env.

Done when: `rtk npm test -- src/keepalive-config.test.ts` passes, V-RELAY passes, and the connect-flow chromium E2E still passes.

### T19a | Operator docs for keep-alive | blocked by: T11

Files: modified `README.md:250-275` (Configuration table), `README.md:436-450`; `relay/README.md:30-40`; `frontend/src/helpTopics.ts:120` (`hosting` topic) and `frontend/src/helpTopics.test.ts`.

Content:
- `KEEPALIVE_MAX_SECONDS`: default 3600; `0` means v1 only; `unlimited` leaves orphans until capacity eviction or restart.
- The wildcard rule (A-01).
- `MAX_SESSIONS` counts active plus detached sessions, with RAM sizing about 896 KiB per session (`11` §4).
- The 90 s detection lag; output stalls while away; server `ClientAliveInterval` can end sessions early; single relay instance; a restart loses sessions; `tmux` advice; capability endpoint path and CORS.
- Remove "Closing the page disconnects all sessions" (`README.md:448`) only once T10 ships. Until then mark it accurate for v1/Off.

Test first: a `helpTopics.test.ts` assertion that the hosting topic names `KEEPALIVE_MAX_SECONDS`.

Done when: `rtk npm test -- src/helpTopics.test.ts` passes. A manual review finds every env var in `compose.yaml` and the scripts in the README table.

Verify: V-FE.

### T12a | Settings dialog, Terminal section | blocked by: T1

Files:
- new: `frontend/src/components/SettingsDialog.tsx`, `frontend/src/components/SettingsDialog.test.tsx`
- removed: `frontend/src/components/TerminalSettings.tsx`
- modified: `frontend/src/App.tsx:13,261-264,550`; `frontend/src/app.css` (dialog and sheet; drop `.terminal-settings`); `frontend/src/storage/settingsStore.ts:56`; `frontend/src/helpTopics.ts:55-66` (`terminal` topic: Settings, and the gesture text moved from the legend)
- tests renaming Appearance: `frontend/src/components/toolbarLabels.test.tsx:17`, `frontend/src/components/accessibilityFocus.test.tsx:11`, `frontend/src/App.test.tsx:924`, `frontend/e2e/connect-flow.spec.ts:574`, `frontend/e2e/font-metrics.spec.ts:32`; also `frontend/src/components/ActionsMenu.tsx:15` comment

Interfaces:
- `SettingsDialog({ open, onClose, value, onChange, activeTarget, returnFocusTo })`.
- `saveTerminalSettings(s): { ok: boolean }`. On failure, the status line shows the `08` failure text.
- Layout and behavior follow `08` S-01 to S-05 and S-09: lucide `Settings` icon, a 560px dialog from 720px up, a full-height sheet below it, focus to the title, focus trapped, focus returned per S-04. The preview is `aria-hidden`.
- Line height as `1.00` to `2.00`.
- If the change exceeds 300 lines, move the S-09 preview to T12b.

Test first:
- The component opens from the toolbar and from Actions, Escape restores focus, each field changes and saves, and the failure path shows its text.
- App test: Actions order is Files, Disconnect, Clipboard, Settings, Help, About.
- The renamed E2E selectors pass.

Done when: `rtk npm test -- src/components/SettingsDialog.test.tsx src/App.test.tsx` and `rtk npm run test:e2e -- e2e/font-metrics.spec.ts --browser=webkit --reporter=line` pass.

Verify: V-FE.

### T12b | Settings Session section: keep-alive and capabilities | blocked by: T12a, T11

Files:
- new: `frontend/src/keepAlive.ts`, `frontend/src/keepAlive.test.ts`, `frontend/src/relayCapabilities.ts`, `frontend/src/relayCapabilities.test.ts`
- modified: `frontend/src/storage/settingsStore.ts` (+`keepAlive`), `settingsStore.test.ts`, `SettingsDialog.tsx`, `SettingsDialog.test.tsx`, `frontend/src/helpTopics.ts` (new `background` topic with `08` draft text)

Interfaces:
- `type KeepAliveChoice` (A-06).
- `requestedGraceMs(c): number | null | "v1"`.
- `formatGrace(ms: number | null): string` uses the `08` format rules.
- `capabilitiesUrl(wsUrl: string): string` (A-02).
- `fetchRelayCapabilities(wsUrl, fetchImpl = fetch): Promise<{ resume: boolean; maxGraceMs: number | null } | "unknown">` with a 5 s timeout.
- Session section: K-01 to K-07, the applies-to line, the always-visible risk text, `aria-describedby`, and the `About background sessions` link, all with `08` strings.

Test first:
- `capabilitiesUrl` for `ws://h/relay`, `wss://h:8443/relay` and `ws://h:8787`.
- Fetch: 404, CORS failure (rejected fetch) and malformed JSON give `unknown`.
- Every K state renders its exact text against a mocked fetch.
- Old JSON gives `120`; an invalid value gives `120`; the choice persists while capped (K-04).

Done when: `rtk npm test -- src/keepAlive.test.ts src/relayCapabilities.test.ts src/components/SettingsDialog.test.tsx src/storage/settingsStore.test.ts` passes.

Verify: V-FE.

### T10 | Page lifecycle, v2 connect, per-tab transport state | blocked by: T12b, T9

Files: modified `frontend/src/App.tsx:86-97` (tab type), `:186-198` (pagehide), `:270-300` (connect); `frontend/src/App.test.tsx`; `frontend/src/connectionErrors.ts`, `frontend/src/connectionErrors.test.ts`; `frontend/e2e/connect-flow.spec.ts`.

Interfaces:
- `TerminalTab` gains `transport?: "connected" | "resuming"`, `grantedGraceMs?: number | null`, `lostWhileHidden?: boolean`.
- At connect: a choice of `off` means v1. Otherwise use the capability result for this page load, fetching again if it was `unknown`. Send `keepAliveMs` only when `resume: true` (A5).
- `pagehide`: v2 tabs call `handle.detach()`, other tabs call `close()`. `pageshow`, `visibilitychange` to visible, and `online` call `handle.resume()` on v2 tabs. Hidden alone does nothing.
- Explicit Disconnect and unmount still `close()`. A reloaded page starts fresh.
- `connectionErrors.ts` maps `expired`, `superseded`, `resume_disabled`, `offset_mismatch` and `retention_exceeded` to the `10` cause lines.

Test first:
- App tests with fake handles: `pagehide` detaches v2 and closes v1 and Off; `pageshow` and `online` resume; explicit Disconnect closes; two tabs stay isolated; `unknown` capabilities connect v1.
- E2E, chromium then webkit, with the global relay on v2 by default after T11: dispatch `pagehide`, drop the socket, dispatch `pageshow`; the same session echoes; a reload shows the connect form.

Done when: `rtk npm test -- src/App.test.tsx src/connectionErrors.test.ts` passes, and `rtk npm run test:e2e -- e2e/connect-flow.spec.ts --browser=webkit --reporter=line` passes.

Verify: V-FE.

### T18a | Resuming state, recovery row, Select text on closed tabs | blocked by: T10

Files: new `frontend/src/components/RecoveryRow.tsx`; modified `frontend/src/App.tsx:575` (switcher status), `:758` (`terminal-select-button` guard), `:800-812` (key bar slot); `frontend/src/components/KeyBar.tsx` (`disabled` prop); `frontend/src/app.css`; `frontend/src/App.test.tsx`; `frontend/e2e/key-bar.spec.ts`.

Interfaces:
- `RecoveryRow({ cause: "background" | "network" | "server" | "user", onReconnect, onClose })`.
- On touch, an active tab with `handle === null` renders the row in place of the key bar (B-04).
- Status text `Resuming` while the tab is resuming (S-13); key bar keys are `aria-disabled` and Keyboard is hidden.
- `Back in session.` is announced politely (S-14).
- Select text shows on disconnected tabs (B-06).
- In this task `Reconnect` calls the existing retry path; T18b replaces it.

Test first: App tests for each S-13 to S-15 text and for focus not moving on return. E2E at 390px: after the session closes, the row replaces the key bar, the tmux hint appears only for the background cause, and Select text opens on the closed tab.

Done when: `rtk npm test -- src/App.test.tsx` and `rtk npm run test:e2e -- e2e/key-bar.spec.ts --browser=webkit --reporter=line` pass.

Verify: V-FE.

### T18b | One-tap Reconnect | blocked by: T18a

Files: modified `frontend/src/App.tsx:270-300` (`attemptConnect` already takes `retryTab`); `frontend/src/components/ConnectDialog.tsx:17-23`; `frontend/src/components/ConnectDialog.test.tsx`; `frontend/src/App.test.tsx`; `frontend/e2e/connect-flow.spec.ts`.

Interfaces:
- `TerminalTab` gains `port: number`, `username: string`, `entryId?: string` (set when `password.kind === "vault"`).
- Reconnect: if `entryId` is set, `vault.status === "unlocked"`, and the entry still exists, call `attemptConnect({ ..., password: { kind: "vault", entryId } }, tab)`.
- Otherwise open the connect view with `ConnectDialogProps.initialValues?: { host: string; port: number; username: string }`, focus the first empty credential, and set a pending reconnect so that success replaces the tab in place (S-17). Going back leaves S-15.
- Typed passwords and keys are never kept for reuse.
- S-16 shows `Connecting to <host>...` with Cancel. S-19 shows the error with Retry.
- Success writes the faint marker line (S-18) through `controls.write`.

Test first:
- App: an unlocked vault reconnects without the form.
- A locked vault, a typed password and a key each open a prefilled form.
- A changed host key still blocks.
- The marker appears once.
- E2E: Reconnect after an expired session with a typed password shows the prefilled form.

Done when: `rtk npm test -- src/App.test.tsx src/components/ConnectDialog.test.tsx` and the connect-flow webkit E2E pass.

Verify: V-FE.

### T13a | Engine download offset and identity | blocked by: T9

Files: modified `engine/remotefiles/remotefiles.go:248`, `engine/remotefiles/remotefiles_test.go`, `engine/sftpjs.go:193,253`, `frontend/src/ssh/engine.ts:32-57`; type-only call sites in `frontend/src/components/FilePanel.tsx:127,160`.

Interfaces:
- `Download(ctx, c, name, dst, opts DownloadOptions, onStart func(size, mtime int64), progress) (grew bool, err error)`, with `DownloadOptions{ Offset int64; ExpectSize, ExpectMtime int64; Tail []byte }`.
- When the offset is above 0: stat, compare size and mtime, read the tail bytes before the offset and compare, then `Seek` and `WriteTo`. pkg/sftp `WriteTo` starts at the handle offset (`11` §6, `client.go:1493` v1.13.12). A mismatch returns `ErrRemoteChanged`.
- JS: `download(path, onChunk, onProgress, opts?: { offset; expectSize; expectMtime; tail: Uint8Array; onStart(info: { size; mtime }) })`.
- The sentinel `REMOTE_FILE_CHANGED = "remote file changed"`.

Test first, Go at the remotefiles seam:
- Resume from 1 MiB gives bytes identical to a full read.
- Changed mtime, changed size and changed tail each return `ErrRemoteChanged`.
- Offset 0 behaves exactly as today.

Done when: `rtk go test ./remotefiles/...` passes, V-ENGINE passes, and the frontend `rtk npm run build` passes.

### T13b | Segmented OPFS writer and transfer record store | blocked by: T13a

Files: new `frontend/src/downloadStore.ts`, `frontend/src/downloadStore.test.ts`; modified `frontend/src/remoteFiles.ts:34` (`sweepDownloads`) and `frontend/src/fileExplorer.test.ts` or a new `remoteFiles.test.ts` if absent.

Interfaces:
- `interface DownloadRecord { id; host; port; user; remotePath; size; mtime; committedBytes; segments: string[]; createdAt }`, stored in an IndexedDB store `downloads`.
- `openSegmentedDownload(dir, record): { write(chunk): Promise<void>; finish(): Promise<Blob>; abort(): Promise<void>; tail(): Promise<Uint8Array> }`. It closes a segment `localssh-dl-<id>-<n>` every 4 MiB and updates `committedBytes` after each `close()`.
- `listRecords()`, `deleteRecord(id)` (removes its segments), and `purgeOld(now)` for records older than 24 h.
- `sweepDownloads` keeps segments that have a live record.

Test first, with `fake-indexeddb` and an in-memory fake `FileSystemDirectoryHandle`:
- 9 MiB gives 3 segments and a final Blob equal to the input.
- An abort mid-segment leaves `committedBytes` at 8 MiB.
- A missing segment marks the record unusable.
- The sweep keeps live segments and removes orphans.
- Purge after 24 h.
- No credentials appear in records (`11` T-07).

Done when: `rtk npm test -- src/downloadStore.test.ts` passes.

Verify: V-FE.

### T13c | Files transfer states within a session | blocked by: T13b, T18a

Files: modified `frontend/src/components/FilePanel.tsx:111-170` (`receiveFile` uses the segmented writer when `createWritable` exists), `:635` (progress block); `frontend/src/components/FilePanel.test.tsx` (create it if absent); `frontend/src/components/RecoveryRow.tsx` (transfer line); `frontend/src/App.tsx` (pass the tab's transport state to FilePanel); `frontend/src/app.css`.

Interfaces:
- `FilePanelProps.transport: "connected" | "resuming"`.
- States X-01 to X-04 with the `10` strings. While resuming, controls other than Cancel are disabled.
- Progress announcements on state change and every 25 percent (`10` §7).
- The close-during-transfer confirmation (`FilePanel.tsx:505`) also covers X-02, X-03 and X-05.
- The recovery row shows `Download of <name> stopped at <N>%.`

Test first: component tests for each X-01 to X-04 text, the disabled controls, and the throttled announcements. The existing upload/download E2E still passes.

Done when: `rtk npm test -- src/components/FilePanel.test.tsx` and `rtk npm run test:e2e -- e2e/connect-flow.spec.ts --browser=chromium --grep "uploads and downloads" --reporter=line` pass.

Verify: V-FE.

### T13d | Download resume after expiry or eviction | blocked by: T13c, T18b

Files: modified `frontend/src/components/FilePanel.tsx` (mount: list records for this host, port and user; X-05 to X-07 actions); `frontend/src/components/FilePanel.test.tsx`; `frontend/e2e/connect-flow.spec.ts`.

Interfaces:
- `Resume download` calls `download(path, ..., { offset: committedBytes, expectSize, expectMtime, tail, onStart })`.
- `REMOTE_FILE_CHANGED` leads to X-06; Retry starts at 0.
- `Cancel` deletes the record and its segments with no confirmation.
- Finishing builds `new Blob(segments)`, shows the save link, and deletes the record.

Test first:
- E2E with a spawned relay at `KEEPALIVE_MAX_SECONDS=2`: start an 8 MiB download, force expiry, reconnect, resume, and the hash equals the source.
- Touch the remote file and resume: X-06, and Retry succeeds.
- Reload with committed segments: resume is offered after login.
- Delete one segment: a clean restart.

Done when: the component tests and `rtk npm run test:e2e -- e2e/connect-flow.spec.ts --browser=chromium --reporter=line` pass.

Verify: V-FE.

### T15a | Key model: order, new keys, modifiers as items | blocked by: T18a

Files: modified `frontend/src/terminalKeys.ts:21-60`, `frontend/src/terminalKeys.test.ts`, `frontend/src/components/KeyBar.tsx:18,60-92`, `frontend/src/storage/settingsStore.ts` (+`keyBarKeys`), `frontend/src/storage/settingsStore.test.ts`, `frontend/src/App.tsx:805-811`, `frontend/src/App.test.tsx`, `frontend/e2e/key-bar.spec.ts`.

Interfaces:
- `TerminalKey` gains `modifier?: ModifierName` and `action?: "text-smaller" | "text-larger"`.
- New keys: `shift-tab` (`\x1b[Z`, spoken `Shift Tab`), `text-smaller`, `text-larger`.
- `DEFAULT_KEY_ORDER` follows `10` K-02.
- `resolveKeyOrder(ids: unknown): string[]` drops unknown ids and duplicates and keeps an empty list.
- `KeyBarProps.keys: readonly TerminalKey[]`. Text keys change `fontSize` within 8 to 32 and announce per S-22; the key at a limit is `aria-disabled`.
- Keep pointer-up activation (`KeyBar.tsx:69,86`, 07 fix).

Test first:
- Order resolution.
- `⇧tab` sends `ESC [ Z` (E2E byte check, webkit tap).
- `A+` at 32 is disabled and announces the limit.
- Ctrl stays sticky (once, then locked) as an ordinary item.

Done when: `rtk npm test -- src/terminalKeys.test.ts src/storage/settingsStore.test.ts src/App.test.tsx` and `rtk npm run test:e2e -- e2e/key-bar.spec.ts --browser=webkit --reporter=line` pass.

Verify: V-FE.

### T15b | Fit-to-width row and More keys panel | blocked by: T15a

Files: modified `frontend/src/components/KeyBar.tsx`, `frontend/src/app.css:1122-1136` (remove `overflow-x: auto` and `touch-action: pan-x`), `frontend/src/App.tsx`, `frontend/src/App.test.tsx`, `frontend/e2e/key-bar.spec.ts`.

Interfaces:
- `ResizeObserver` measures how many keys fit between fixed Keyboard (first) and `More keys` (last).
- `KeyBarProps.onCapacityChange?(n: number)`.
- The More keys panel (`role="group"`, `aria-expanded`, `aria-controls`) blurs the terminal to drop the system keyboard. It holds up to 4 rows, capped at 40 percent of the visual viewport, and scrolls inside.
- It closes on Keyboard, More keys, Escape, a session change, Files, Settings or Resuming (S-20).
- The empty-list text follows `10`.

Test first, E2E at 320px and 390px:
- No horizontal scroll.
- The visible count matches `10` 4.1: at 320px, Keyboard plus 4 keys plus More.
- A panel key sends and the panel stays open.
- The panel closes on Files.
- Escape returns focus to More keys.

Done when: the App tests and the key-bar webkit E2E pass.

Verify: V-FE.

### T12c | Key bar section and editor in Settings | blocked by: T15b, T12a

Files: new `frontend/src/components/KeyBarEditor.tsx`, `frontend/src/components/KeyBarEditor.test.tsx`; modified `SettingsDialog.tsx`, `SettingsDialog.test.tsx`, `frontend/src/App.tsx` (pass capacity and coarse-pointer state), `frontend/src/app.css`.

Interfaces:
- `KeyBarEditor({ order, capacity, onChange, onBack, onClose })`.
- Move up, Move down, Remove and Add (44px each), Reset, and the live divider at `capacity`.
- Focus follows the moved key; end buttons are `aria-disabled` and stay focusable.
- Status strings per `10` §6. The section shows only on a coarse pointer.

Test first: move, add, remove and reset change the order and persist; focus stays on the moved row's control; the announcements match; there is no section on a fine pointer.

Done when: `rtk npm test -- src/components/KeyBarEditor.test.tsx src/components/SettingsDialog.test.tsx` passes.

Verify: V-FE.

### T17 | Short-landscape combined row | blocked by: T15b

Files: new `frontend/src/shortLandscape.ts`, `frontend/src/shortLandscape.test.ts`; modified `frontend/src/App.tsx`, `frontend/src/app.css`, `frontend/e2e/key-bar.spec.ts`.

Interfaces:
- `isShortLandscape(viewport: ViewportLike): boolean` is true when the visual viewport is under 400px tall and over 600px wide. Reuse `ViewportLike` and its sampling (`frontend/src/viewportHeight.ts:22,40`).
- The combined row puts the target button, the keys, More and Actions at the top of the visual viewport.
- The target middle-truncates past 35 percent of the row. Its accessible name keeps the full target and state.

Test first: unit tests for the threshold. E2E at an 844x390 viewport: one row, target and Actions both operable, and `Resuming`/`Disconnected` shown as text.

Done when: `rtk npm test -- src/shortLandscape.test.ts` and the key-bar webkit E2E pass.

Verify: V-FE.

### T16a | Vault per-host terminal settings field | blocked by: T1

Files: modified `engine/vault/document.go:31-64`, `engine/vault/document_test.go`, `engine/vaultjs.go` (summary and update JSON), `frontend/src/vault/vaultEngine.ts:8-29`, `frontend/src/vault/useVault.ts:23-36`; type-only fixtures in the SavedHosts tests if they break.

Interfaces:
- Go `Entry.Terminal *TerminalPrefs \`json:"terminal,omitempty"\``, with `TerminalPrefs{ FontFamily string; FontSize int; LineHeight float64; ThemeName string }`. Go validates the ranges; the family and theme allowlists stay on the page side.
- `EntryUpdate.Terminal`: absent keeps the value, an explicit null clears it.
- `SavedEntry.terminal?` and `EntryInput.terminal?: TerminalPrefs | null`.
- Old vault documents load with no override (`10` Q-05).

Test first: Go round trip; an old document without the field; out-of-range values rejected; absent versus null on update.

Done when: `rtk go test ./vault/...` and V-ENGINE pass, and the frontend `rtk npm test -- src/vault` and build pass.

### T16b | Settings "Apply to" scope | blocked by: T16a, T18b, T12c

Files: modified `SettingsDialog.tsx`, `SettingsDialog.test.tsx`, `frontend/src/App.tsx` (per-tab effective settings at both `<Terminal>` sites, `:706`, `:730`), `frontend/src/App.test.tsx`.

Interfaces:
- `effectiveTerminalSettings(global, entry?: SavedEntry, vaultUnlocked: boolean): TerminalSettings`.
- `Apply to` follows H-01 to H-05. `Use all-hosts settings for this host` saves `terminal: null`.
- Uses `TerminalTab.entryId` from T18b. Host names never go to `localStorage`.

Test first: each H state's text; an override applies only to the matching tab; locking the vault falls back to all-hosts settings; removing the override restores them.

Done when: `rtk npm test -- src/components/SettingsDialog.test.tsx src/App.test.tsx` passes.

Verify: V-FE.

### T19b | User docs, Help, and the `DESIGN.md` delta | blocked by: T16b, T17, T13d

Files: modified `README.md:436-572` (Terminal, Phones and tablets, Key bar, Touch gestures, Clipboard); `docs/USER-GUIDE.md:6-90`; `frontend/src/helpTopics.ts` (`terminal`, `files`, `clipboard`, `troubleshooting`, `background`); `frontend/src/helpTopics.test.ts`; `DESIGN.md` (`08` delta; `10` M-01 to M-12, with M-05 marked LOW pending a device).

Content: Settings replaces Appearance; line height; the keep-alive options and the risk text; Resuming, recovery and Reconnect rules (vault only); Select text on closed tabs; More keys, the editor and Text keys; landscape; per-host settings; transfer pause and resume, including loss when iOS evicts the page. Remove stale swipe Tab/Esc, close-on-pagehide and Appearance claims.

Test first: a `helpTopics.test.ts` assertion for the new guidance and the absence of `Appearance`, `Swipe right` and "Closing the page disconnects". Use `rtk grep -rn "Appearance\|Swipe" README.md docs frontend/src` as the manual sweep.

Done when: the tests pass, the sweep returns only intended hits, and V-FE passes.

## 4. Reuse and out of scope

Reuse:
- `attemptConnect(values, retryTab)` for Reconnect (`App.tsx:270`).
- Vault `fromVault` auth (`engine.ts:194,226`).
- `snapshotTerminalText` and the T4 view.
- T6/T7 session, replay and backpressure code.
- `runKeepalives` and its fake-conn seam (`client.go:159`, `keepalive_test.go`).
- `remotefiles.Download` and its tests.
- `originDirectory` and `sweepDownloads` (`remoteFiles.ts:21,34`).
- `fake-indexeddb`.
- `trackViewportHeight` / `ViewportLike`.
- `assertOriginAllowed` for capability CORS.
- No new dependency.

Out of scope:
- Upload offset resume (T14, deferred by `11`).
- Direct native handles on live xterm rows.
- Relay-side transfer completion (`11` A13).
- Pinch zoom (`10` P-6).
- Hardware-keyboard auto-hide (`10` P-7).
- Per-host startup commands.
- Desktop recovery row (A-03).
- A sessionStorage revoke-on-reload credential (`11` §4).

## 5. Check findings and risks

Fixed in this plan:
- P-01 | HIGH | T3a | changing the `ready` shape alone breaks the built relay and the half-applied `wsconn`, leaving resume red | T3a owns the minimal call-site adaptation in both, and its done-when runs the resume E2E.
- P-02 | HIGH | T9 | the brief says T9 is built, but the T9 report and `git status` show no code | T9 is planned as remaining work.
- P-03 | HIGH | T6a, T11 | Node clamps timers above 2^31-1 ms to 1 ms, so large grants would expire at once | T6a chains timers, and T11 bounds the env value at 2147483 s, with `unlimited` for longer.
- P-04 | MED | T10 | the full WebKit connect-flow run fails on Chromium-only CDP (07 R-01) | T8a scopes that test to Chromium.
- P-05 | MED | T12b, T10 | the Settings link to a Help topic that does not exist yet | T12b adds the `background` topic with draft text, and T19b finalizes it.
- P-06 | MED | T18b, T16b | per-host scope needs the tab's vault `entryId` | T18b adds it, and T16b is blocked by T18b.

Remaining:
- F-01 | MED | security | default-on v2 outside the wildcard case, rotation and takeover still need security sign-off (`11` T-06) | review after T6c, before release.
- F-02 | MED | T6c | behind nginx every client shares one `remoteAddress`, so the 20/min resume-failure limit is effectively global | acceptable because failures need a bad token; revisit with device data.
- F-03 | MED | T12b, T10 | a cross-origin relay can be blocked by the page CSP (`connect-src 'self' ws: wss:`, `deploy/nginx.conf:8`, `web-server.ts:17`); the fetch then fails and the page falls back to v1 | documented in T19a. Supported deployments are same-origin.
- F-04 | LOW | T12a, T13c, T13d, T18b | each may exceed 300 lines | split points are named in T12a. For the others, split UI and tests across two commits within the same task ID.

Risks, one line each:
- Once T11 runs, the global E2E relay supports v2, and after T10 every app E2E uses v2 by default, which can surface latent transport defects.
- iOS may keep a suspended page's socket open (`11` F-A1); the 90 s heartbeat bounds it, unmeasured.
- An OPFS writable may not survive suspension (`11` F-A2); T13d's offset resume covers it.
- Server `ClientAliveInterval` can end held sessions early.
- Long grace widens local-device risk (`11` T-04); the risk text stays always visible.
- All numeric limits are starting values (`11` §4, LOW).

Release gate (from `05` plus `11` §8), not provable in Playwright: physical iPhone Safari for selection, landscape, VoiceOver, background at 30 s, 3 min, 20 min and 70 min during a 200 MB download, Wi-Fi to cellular, eviction, and reload resume.

## 6. Unverified items

- No command in this plan was run by this step. Done-when commands are proposed. Spec paths that do not exist yet are new files.
- SUSPECTED, not confirmed in the project:
  - `frontend/src/components/FilePanel.test.tsx` and `frontend/src/remoteFiles.test.ts` may not exist; create them if absent.
  - The `engine/vaultjs.go` JSON field handling for summaries was not read.
  - `ConnectDialog` focus management for prefill was not read.
  - The fit of the `connect-flow.spec.ts` socket-capture hook for the takeover test.
  - `--grep` with these test titles.
- New interfaces in this plan (codec fields, `maxGraceMs`, `handleCapabilities`, `parseKeepaliveMaxGraceMs`, `DialResumable` signature, `keepAliveMs`, `PauseKeepalives`, `DownloadOptions`, `downloadStore` API, `RecoveryRow`, `KeyBarEditor`, `TerminalPrefs`) are proposals, not existing APIs.
- pkg/sftp `WriteTo` offset behavior and the absence of a request timeout are taken from `11` (local module source v1.13.12); this step did not re-read them.
- iOS background, socket and OPFS behavior is unverified until device tests.

Hand off: featurebuilder takes one task at a time in the order below, or the whole plan as its spec.

ORDER: T1 T3a T6a T6c T6b T8a T8b T9 T11 T19a T12a T12b T10 T18a T18b T13a T13b T13c T13d T15a T15b T12c T17 T16a T16b T19b
