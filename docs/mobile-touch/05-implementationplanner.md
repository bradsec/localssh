# Phase 2 mobile touch implementation plan

Building: mobile selection, compact sessions, adjustable line height, and short SSH session resume for browser SSH users; done means native Copy in a read-only view and bounded recovery of a live page's session.

> For featurebuilder: take one task or the whole plan as its spec. Read the four approved inputs and this plan. Write each named failing test before implementation. Do not commit unless the lead separately asks.

**Inputs:** [research](01-researchanalyst.md), [UI design](02-uiuxdesigner.md), [architecture](03-solutionarchitect.md), [font fix](04-debugengineer.md). The existing uncommitted `Terminal.tsx` font fix and `font-metrics.spec.ts` are the baseline, not work to recreate or discard.

## Decisions, assumptions, and open questions

- Lead decision, HIGH: stationary long press on live output and a visible **Select text** control both open a read-only snapshot view. Native iOS handles and system Copy operate inside that view. UI design F-05, T-03, T-05, S-07, M-06, and V-02 statements requiring handles directly on live xterm rows are superseded. Direct row selection is out of scope.
- Assumption, MED: use xterm's active buffer at view-open time, freeze it, and do not update the snapshot during selection. Research rank 1 calls for a read-only view; xterm's local buffer API exposes `active`, `isWrapped`, and `translateToString` [frontend/node_modules/@xterm/xterm/typings/xterm.d.ts:1573](../../frontend/node_modules/@xterm/xterm/typings/xterm.d.ts#L1573), [line 1600](../../frontend/node_modules/@xterm/xterm/typings/xterm.d.ts#L1600), [line 1632](../../frontend/node_modules/@xterm/xterm/typings/xterm.d.ts#L1632). Confidence MED until physical Safari proof.
- Assumption, MED: line height defaults to the existing `1.15`, with a `1.0` to `2.0` picker in `0.05` steps. xterm 6 types accept a number, but do not define a safe range [frontend/node_modules/@xterm/xterm/typings/xterm.d.ts:150](../../frontend/node_modules/@xterm/xterm/typings/xterm.d.ts#L150). The range is a product judgment, not an upstream limit.
- Question, architecture versus research: research F-10 suggests a fresh SSH reconnect after loss, while approved architecture R1/D1 requires reattaching the same WASM `net.Conn`. Is the architecture intended to supersede F-10? This plan assumes yes, HIGH, because the architecture is the later approved session-resume contract.
- Question, rollout/security: architecture calls v2 opt-in and leaves public unauthenticated deployment policy to security review. Should v2 be disabled when `ALLOWED_ORIGINS=*` or another public policy is used? Keep v1 the default until that decision; do not silently enable v2 for public deployments. Confidence HIGH from architecture D4/F5 and current all-in-one wildcard defaults [relay/scripts/run-all-in-one.ts:21](../../relay/scripts/run-all-in-one.ts#L21).
- Question, physical threshold: if landscape with keyboard shows fewer than three prompt rows, UI design asks for an explicit **Hide keyboard** control. The current key bar already has that control [frontend/src/components/KeyBar.tsx:36](../../frontend/src/components/KeyBar.tsx#L36). Is any extra control intended? Assume no, MED.

## Map and frozen boundaries

Project structure: React/Vite frontend, xterm 6, Go 1.27.3 WASM SSH engine, Node 26 relay. Vitest covers frontend and relay units; Playwright uses a disposable SSH server [frontend/package.json:7](../../frontend/package.json#L7), [relay/package.json:7](../../relay/package.json#L7), [engine/go.mod:3](../../engine/go.mod#L3), [frontend/playwright/global-setup.ts:117](../../frontend/playwright/global-setup.ts#L117). Existing commands: `rtk npm test`, `rtk npm run build`, `rtk npm run lint`, `rtk npm run format:check` in each npm package; `rtk npm run test:e2e -- <spec>` in `frontend/`; `rtk go test ./...` in `engine/`. Go WASM transport has no current unit-test seam; the browser E2E seam exercises it [engine/wsconn/wsconn.go:1](../../engine/wsconn/wsconn.go#L1).

Reuse: settings storage [frontend/src/storage/settingsStore.ts:4](../../frontend/src/storage/settingsStore.ts#L4), Appearance picker [frontend/src/components/TerminalSettings.tsx:7](../../frontend/src/components/TerminalSettings.tsx#L7), xterm controls and font remeasurement [frontend/src/components/Terminal.tsx:18](../../frontend/src/components/Terminal.tsx#L18), tabs and Actions [frontend/src/App.tsx:105](../../frontend/src/App.tsx#L105), viewport fitting [frontend/src/viewportHeight.ts:1](../../frontend/src/viewportHeight.ts#L1), relay access checks [relay/src/local-relay.ts:154](../../relay/src/local-relay.ts#L154), v1 protocol [relay/src/protocol.ts:1](../../relay/src/protocol.ts#L1). No new terminal library, selection library, or relay store.

Frozen: SSH authentication and host-key verification remain in Go WASM [engine/main.go:118](../../engine/main.go#L118); relay sees opaque bytes only [relay/src/local-relay.ts:259](../../relay/src/local-relay.ts#L259); existing v1 frames and access checks remain valid [relay/src/protocol.ts:25](../../relay/src/protocol.ts#L25); desktop toolbar and tabs remain [DESIGN.md:48](../../DESIGN.md#L48). Phone layout changes require the approved `DESIGN.md` delta, which revises its old session-phone rule [DESIGN.md:57](../../DESIGN.md#L57). Existing Files replacement below 920px and connect/host-key flow remain [DESIGN.md:47](../../DESIGN.md#L47).

Test boundaries: settings storage through `loadTerminalSettings`; visual settings through `TerminalSettings` and browser row geometry; selection through xterm `TerminalControls` and the visible view; phone navigation through `App` and Playwright; relay protocol through `decodeConnectFrame` and new v2 codecs; byte continuity through the real browser-WASM-relay-test-SSH-server path. Tests must cover Unicode/wrap/alternate buffer, blocked clipboard, multiple tabs, lost transport, expiry, offset mismatch, retained-byte caps, transfer interruption, and page eviction.

## Ordered tasks

Each task targets one session, one focused review, and about 300 changed lines at most. The named command is proposed, not a claim of a passing run. Run it from the named package directory. Parallel groups below have disjoint write sets.

T1 | Persistent line-height preference | blocked by: none | parallel group A with T3

Files: `frontend/src/storage/settingsStore.ts` modified [line 4](../../frontend/src/storage/settingsStore.ts#L4); `frontend/src/storage/settingsStore.test.ts` modified [line 7](../../frontend/src/storage/settingsStore.test.ts#L7); `frontend/src/components/TerminalSettings.tsx` modified [line 7](../../frontend/src/components/TerminalSettings.tsx#L7); `frontend/src/components/Terminal.tsx` modified [line 40](../../frontend/src/components/Terminal.tsx#L40); `frontend/e2e/font-metrics.spec.ts` modified [line 10](../../frontend/e2e/font-metrics.spec.ts#L10).

Interfaces: add `lineHeight: number` to `TerminalSettings` and `TerminalProps`; `loadTerminalSettings(): TerminalSettings` accepts only finite values in `[1.0, 2.0]`, default `1.15`; `saveTerminalSettings(settings: TerminalSettings): void` persists it. Appearance offers `1.0` through `2.0` in `0.05` steps. Live xterm option update refits without rebuilding the terminal or undoing the uncommitted font fix.

Test first: storage defaults for old JSON, malformed/NaN/out-of-range values, and round trip at `1.35`; browser test changes the picker while connected, observes changed row spacing and PTY fit, reloads, and observes persistence; retain delayed-font regression.

Done when: `rtk npm test -- src/storage/settingsStore.test.ts` and `rtk npm run test:e2e -- e2e/font-metrics.spec.ts --browser=webkit --reporter=line` in `frontend/` pass, with live and reloaded row height matching the chosen value.

T2 | Snapshot text extraction | blocked by: none | parallel group B with T3; run after T1 if T1 starts first

Files: `frontend/src/terminalSnapshot.ts` new; `frontend/src/terminalSnapshot.test.ts` new; `frontend/src/components/Terminal.tsx` modified [line 18](../../frontend/src/components/Terminal.tsx#L18).

Interfaces: proposed `snapshotTerminalText(buffer: IBuffer): string` in the new file; add `snapshotText(): string` to `TerminalControls` [frontend/src/components/Terminal.tsx:18](../../frontend/src/components/Terminal.tsx#L18). Use the active normal or alternate buffer at invocation. Preserve meaningful spaces and Unicode, join soft wraps without an added newline, separate hard lines, and never expose ANSI bytes or accessibility mirror text. Bound extraction to xterm's retained buffer.

Test first: synthetic normal and alternate buffer lines, hard/soft wraps, wide Unicode, blank lines, and trailing spaces at the public snapshot function; assert no escapes. A fake buffer is sufficient for the pure conversion seam.

Done when: `rtk npm test -- src/terminalSnapshot.test.ts` in `frontend/` passes with exact text for each case.

T3 | Versioned relay frame contract | blocked by: none | parallel group A with T1 or B with T2

Files: `relay/src/protocol.ts` modified [line 1](../../relay/src/protocol.ts#L1); `relay/src/protocol.test.ts` modified [line 1](../../relay/src/protocol.test.ts#L1).

Interfaces: preserve `ConnectFrame`, `encodeConnectFrame`, and `decodeConnectFrame`. Add proposed discriminated v2 `connect`, `ready`, `resume`, `resumed`, `data`, `ack`, `detach`, and terminal-error frame types and encode/decode functions in the same module. V2 carries a protocol version, direction, monotonic byte offsets, and opaque byte payload; control frames are bounded and validate every field. Resume carries session ID, bearer token, both ACK offsets, and no target. Specify wire encoding in the test before engine work; reject unsafe integers, bad lengths, unknown versions, and inconsistent offsets.

Test first: v1 fixtures unchanged; v2 round trips and malformed versions, offsets, token fields, duplicate/conflicting payloads. Test at exported codecs, not relay internals.

Done when: `rtk npm test -- src/protocol.test.ts` in `relay/` passes and v1 encoding remains byte-for-byte compatible.

T4 | Read-only Select text view and entry points | blocked by: T2

Files: `frontend/src/components/Terminal.tsx` modified [line 40](../../frontend/src/components/Terminal.tsx#L40); `frontend/src/App.tsx` modified [line 105](../../frontend/src/App.tsx#L105); `frontend/src/app.css` modified [line 567](../../frontend/src/app.css#L567); `frontend/src/App.test.tsx` modified [line 21](../../frontend/src/App.test.tsx#L21); `frontend/e2e/touch-selection.spec.ts` modified [line 1](../../frontend/e2e/touch-selection.spec.ts#L1).

Interfaces: add `onSelectText?: () => void` to `TerminalProps`; App opens a per-active-tab frozen snapshot from `TerminalControls.snapshotText()`. Add a visible `Select text` button in live phone controls and a stationary long-press trigger on live output. The view uses normal selectable DOM text and a close control; entering it blurs and disables terminal input, leaving SSH output running. Closing clears snapshot text, restores the prior tab/scroll position, and allows tap-to-focus. Existing Clipboard paste and fallback remain. Do not promise native handles on xterm rows.

Test first: App test verifies both entry paths, no input while open, snapshot remains frozen as output arrives, close clears it, and tab close cannot show stale text. E2E checks view text, native browser selection and Copy where automation supports it, and no paste into shell. Physical Safari handles are a release gate, not a Playwright claim.

Done when: `rtk npm test -- src/App.test.tsx` and `rtk npm run test:e2e -- e2e/touch-selection.spec.ts --browser=webkit --reporter=line` in `frontend/` pass; browser selection comes from the view's DOM.

T5 | Phone gestures, session switcher, and compact layout | blocked by: T4

Files: `frontend/src/App.tsx` modified [line 499](../../frontend/src/App.tsx#L499); `frontend/src/components/Terminal.tsx` modified [line 240](../../frontend/src/components/Terminal.tsx#L240); `frontend/src/components/TerminalSettings.tsx` modified [line 97](../../frontend/src/components/TerminalSettings.tsx#L97); `frontend/src/app.css` modified [line 2311](../../frontend/src/app.css#L2311); `frontend/src/App.test.tsx` modified [line 21](../../frontend/src/App.test.tsx#L21); `frontend/e2e/key-bar.spec.ts` modified [line 1](../../frontend/e2e/key-bar.spec.ts#L1); `DESIGN.md` modified [line 4](../../DESIGN.md#L4).

Interfaces: below 720px in an active session, target/status button opens `Open terminals` switcher with entries, separate close actions, and `New terminal`; one 44px minimum target/Actions row, 60px maximum when wrapped. Keep tablet/desktop tabs and existing keyboard shortcut. On phone, one-finger vertical drag scrolls; horizontal drag and prompt flick send no hidden Tab/Esc/arrow input. Keep visible key-bar keys, ordering from design L-08, 44px targets, safe-area and visual-viewport fit. Update `DESIGN.md` with approved M-01 to M-09 delta and remove its contradictory phone rule.

Test first: App tests switch between two sessions, close one without closing the other, connecting/disconnected labels, Escape/outside dismissal and focus return; browser tests at 320px and 390px with keyboard and Files open check no overlap, safe areas, and no gesture-generated bytes. Verify desktop tabs still work.

Done when: `rtk npm test -- src/App.test.tsx` and `rtk npm run test:e2e -- e2e/key-bar.spec.ts --browser=webkit --reporter=line` in `frontend/` pass; 320px target and Actions stay separately operable.

T6 | Relay session ownership and bounded retention | blocked by: T3

Files: `relay/src/local-relay.ts` modified [line 50](../../relay/src/local-relay.ts#L50); `relay/src/local-relay.test.ts` modified [line 8](../../relay/src/local-relay.test.ts#L8).

Interfaces: add proposed opt-in `resumableSessions?: boolean` to `LocalRelayOptions`; default false preserves v1. V2 session owns TCP, random 256-bit bearer token, original origin, deadline, one attached socket, and 120-second detach grace. Count active plus detached sessions against `maxSessions`; revoke on explicit close, target close, deadline, and relay shutdown. Cap unacknowledged bytes at 256 KiB per direction and detached total at 16 MiB; pause TCP read at cap, expire oldest detached on global pressure. Token remains out of URL and logs.

Test first: relay test uses injected `targetConnector` to check v1 close behavior, v2 detach without TCP destruction, token/origin/expiry rejection, one attachment, active-plus-detached capacity, caps, oldest-session expiry, target close, and shutdown cleanup.

Done when: `rtk npm test -- src/local-relay.test.ts` in `relay/` passes with no token in captured logs and no retained sockets after shutdown.

T7 | Relay ordered delivery and replay | blocked by: T6

Files: `relay/src/local-relay.ts` modified [line 202](../../relay/src/local-relay.ts#L202); `relay/src/local-relay.test.ts` modified [line 8](../../relay/src/local-relay.test.ts#L8).

Interfaces: v2 relay ACKs client bytes only after ordered TCP acceptance; buffers server bytes until consumer ACK; resends unacknowledged ranges after reattach; ignores matching duplicates and fails closed on gaps or conflicting overlap. WebSocket send callback is not a consumer ACK. Enforce outbound `bufferedAmount` and bounded input queues. V1 remains raw binary.

Test first: inject a TCP stub; drop old WebSocket after send but before ACK in each direction; resume and assert exact bytes once, correct offset, mismatch closure, and backpressure. Include two concurrent sessions to prove isolation.

Done when: `rtk npm test -- src/local-relay.test.ts` in `relay/` passes with exactly-once accepted TCP input and ordered replayed output.

T8 | WASM transport resume and byte accounting | blocked by: T3, T7

Files: `engine/wsconn/wsconn.go` modified [line 56](../../engine/wsconn/wsconn.go#L56); `engine/main.go` modified [line 118](../../engine/main.go#L118); `frontend/src/ssh/engine.ts` modified [line 1](../../frontend/src/ssh/engine.ts#L1); `frontend/e2e/connect-flow.spec.ts` modified [line 1](../../frontend/e2e/connect-flow.spec.ts#L1).

Interfaces: keep `wsconn.Dial(ctx, wsURL, host, port)` and `net.Conn` semantics; v2 opt-in must be explicit and allow v1 fallback for old relay/page deployments. Proposed transport status callback on `sshConnect` reports `connected | reconnecting | expired` to frontend; handle gains `detach(): void` for page lifecycle. The same `Conn` and SSH session survive WebSocket replacement. Reads and writes wait across transport loss within grace; ACK after stream consumption; bounded queues and deadlines return a specific terminal error on expiry, missing bytes, or mismatch. Never reauthenticate on resume.

Test first: browser E2E drops transport around ACK boundaries with disposable SSH server; execute a side-effecting shell command once, compare exact output, and verify two tabs stay isolated. Test expiry and deliberate close. Add focused Go tests at existing `sshclient` or `writequeue` seams only for keepalive/queue logic changed here; do not add test-only production hooks.

Done when: `rtk go test ./...` in `engine/` and `rtk npm run test:e2e -- e2e/connect-flow.spec.ts --browser=chromium --reporter=line` in `frontend/` pass; same session continues after a dropped WebSocket without duplicate command execution.

T9 | Keepalive pause and transfer loss | blocked by: T8

Files: `engine/sshclient/client.go` modified [line 153](../../engine/sshclient/client.go#L153); `engine/sshclient/keepalive_test.go` modified [line 44](../../engine/sshclient/keepalive_test.go#L44); `engine/main.go` modified [line 199](../../engine/main.go#L199); `frontend/e2e/connect-flow.spec.ts` modified [line 1](../../frontend/e2e/connect-flow.spec.ts#L1).

Interfaces: transport detachment pauses SSH keepalive probes; resume restarts them without losing the existing session; genuine expiry closes it. In-flight SFTP either resumes safely or reports failure without false upload/download completion. Existing staged-upload cleanup contract remains [engine/main.go:306](../../engine/main.go#L306).

Test first: fake keepalive connection checks no probes while detached and normal cadence after resume; browser E2E interrupts transfer and checks visible result and no false success.

Done when: `rtk go test ./sshclient ./...` in `engine/` and `rtk npm run test:e2e -- e2e/connect-flow.spec.ts --browser=chromium --reporter=line` in `frontend/` pass.

T10 | Page lifecycle and per-tab recovery | blocked by: T5, T8, T9

Files: `frontend/src/App.tsx` modified [line 177](../../frontend/src/App.tsx#L177); `frontend/src/App.test.tsx` modified [line 21](../../frontend/src/App.test.tsx#L21); `frontend/src/connectionErrors.ts` modified [line 1](../../frontend/src/connectionErrors.ts#L1); `frontend/src/connectionErrors.test.ts` modified [line 1](../../frontend/src/connectionErrors.test.ts#L1); `frontend/e2e/connect-flow.spec.ts` modified [line 1](../../frontend/e2e/connect-flow.spec.ts#L1).

Interfaces: replace `pagehide` close-all with v2 detach while keeping explicit Disconnect and React unmount cleanup; use `pageshow`, visible transition, and socket-loss status to show Connected, Reconnecting, or Session expired. Bound retries to the relay deadline. Evicted/reloaded page starts fresh verified login, never claims a resumed SSH session. Preserve other tabs and Files state; no stale handle calls after expiry. V1 behavior remains close-on-pagehide.

Test first: App tests `pagehide`/`pageshow`, hidden/visible, multiple tabs, explicit disconnect, expiry, and fresh reload. E2E verifies resumed page versus reloaded page and visible recovery instructions.

Done when: `rtk npm test -- src/App.test.tsx src/connectionErrors.test.ts` and `rtk npm run test:e2e -- e2e/connect-flow.spec.ts --browser=webkit --reporter=line` in `frontend/` pass.

T11 | Opt-in wiring, operator limits, and documentation | blocked by: T10

Files: `relay/scripts/run-relay.ts` modified [line 33](../../relay/scripts/run-relay.ts#L33); `relay/scripts/run-all-in-one.ts` modified [line 26](../../relay/scripts/run-all-in-one.ts#L26); `relay/scripts/run-local-relay.ts` modified [line 1](../../relay/scripts/run-local-relay.ts#L1); `frontend/playwright/global-setup.ts` modified [line 150](../../frontend/playwright/global-setup.ts#L150); `README.md` modified [line 250](../../README.md#L250) and [line 436](../../README.md#L436); `docs/USER-GUIDE.md` modified [line 32](../USER-GUIDE.md#L32); `frontend/src/helpTopics.ts` modified [line 44](../../frontend/src/helpTopics.ts#L44); `relay/README.md` modified [line 1](../../relay/README.md#L1); `frontend/src/helpTopics.test.ts` modified [line 1](../../frontend/src/helpTopics.test.ts#L1).

Interfaces: wire one explicit v2 opt-in for deployed relay and matching frontend, with v1 default and no downgrade after v2 has started a session. Validate the opt-in value. Document 120-second grace, 256-KiB-per-direction and 16-MiB detached caps, active-plus-detached `MAX_SESSIONS`, one-instance proxy routing, restart loss, SSH server timeout limits, optional host-managed `tmux`/`screen`, selection view and Copy, phone switcher/gestures, and persisted line height. Update in-app Help to remove stale gesture and close-on-pagehide claims. Security review decides public/wildcard policy before enabling v2 there.

Test first: configuration test via existing relay integration seam checks default v1 and opt-in v2; Help test asserts new guidance and no stale instruction. Manual doc review checks every old session/gesture/clipboard statement in README and USER-GUIDE.

Done when: `rtk npm test` and `rtk npm run build` in `relay/`, then `rtk npm test`, `rtk npm run build`, `rtk npm run lint`, and `rtk npm run format:check` in `frontend/` pass; docs and Help agree with shipped behavior.

## Coverage and parallelism

| Requirement | Tasks |
| --- | --- |
| xterm retained; native Select text view, long press and visible entry, system Copy, fallback | T2, T4 |
| Phone session row/switcher, key bar, touch gestures, responsive/a11y states, approved DESIGN delta | T5, T10 |
| User-configurable persisted live line height with validation | T1 |
| v1 compatibility and opt-in v2, relay access/security bounds | T3, T6, T7, T11 |
| Same-WASM-session resume, byte order, tab isolation, keepalive and SFTP failure | T8, T9, T10 |
| README, USER-GUIDE, Help, deployment guidance | T11 |
| Physical iPhone Safari handles, keyboard fit, VoiceOver and network/background tests | Release gate below |

Parallel group A: T1 with T3. Parallel group B: T2 with T3 if T1 has not started. T1 and T2 both edit `Terminal.tsx`, so execute them sequentially. T6 and T4 can run in parallel after their blockers because their write sets differ. T7 and T5 can run in parallel after their blockers. Do not overlap T8, T9, or T10 with tasks touching their files.

## Release gate, findings, and risk

Physical iPhone Safari verification is required before calling native handles done: portrait and landscape, keyboard open/closed, long press and visible entry, Unicode/wrap/scrollback/alternate-screen Copy, VoiceOver, zoom, safe areas, 320px target reach, lock/app switch, poor network, and page eviction. Capture expected versus actual and adjust the owning task before release. Desktop Playwright WebKit does not establish iPhone behavior. Confidence LOW until device tests.

Resolved plan finding: `P-01 | MED | parallel group A | T1/T2 both edit Terminal.tsx | serialize them; only pair either with T3.`

Remaining findings: `F-01 | MED | T11 | public/wildcard v2 policy needs security decision | keep v1 default and gate public enablement.` `F-02 | MED | release gate | iPhone native selection and landscape fit unproven | physical device proof.` No requirement lacks a task.

Risks: retained sockets consume resources until deadline; thresholds are architecture starting values, not measured capacity. Reverse proxy routing to a different relay instance makes resume fail. A suspended page cannot answer an SSH server's application keepalive, so the target may close first. Page eviction loses WASM crypto state and requires a new verified login. Snapshot text may include sensitive output; clear it on close, tab close, and page exit.

Unverified: no commands were run by this planning step. The proposed v2 codec names, opt-in name, status callback, and `detach()` are new interfaces, not existing APIs. Browser selection handles, actual iPhone landscape geometry, server idle policy, workload caps, and public deployment policy remain unverified. Local xterm 6 types and package scripts were checked in this worktree on 2026-11-02; no changing external API claim is used.

## Notes for the lead

The selection decision is incorporated. T1 and T2 share `Terminal.tsx`, so they must run sequentially despite otherwise independent tests. Security policy and physical iPhone proof remain release decisions. Featurebuilder can take T1 first, or the full ordered plan.
