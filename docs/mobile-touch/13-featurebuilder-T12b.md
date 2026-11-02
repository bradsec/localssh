# T12b feature builder report

Building: a keep-alive choice and relay capability status in Settings for browser SSH users, done means the choice persists and the Session section shows the server's effective limit.

## Assumptions

- The existing `RELAY_WS_URL` from `App.tsx` identifies the relay queried by Settings. Confidence HIGH: the same value feeds `connectSession`.
- An open terminal means an existing tab, including a disconnected tab. Confidence MED: the plan says the applies-to line appears while terminals are open.
- T10 will use `requestedGraceMs` to select v1 or v2 at connection time. T12b only stores and displays the choice. Confidence HIGH: the implementation plan assigns connection gating to T10.
- No branch or commit was made, per the task's final instruction. The accepted dirty worktree was preserved.

## Built and files changed

- `frontend/src/keepAlive.ts`, `keepAlive.test.ts`: exact seven-choice type, v1/grace mapping, and cap formatting.
- `frontend/src/relayCapabilities.ts`, `relayCapabilities.test.ts`: relay capability URL, strict response parsing, and 5-second abort.
- `frontend/src/storage/settingsStore.ts`, `settingsStore.test.ts`: 2-minute default, invalid and old JSON fallback, persisted choice.
- `frontend/src/components/SettingsDialog.tsx`, `SettingsDialog.test.tsx`: Session control, K-01 to K-07 copy, risk text, applies-to line, accessible descriptions, background Help link.
- `frontend/src/App.tsx`: passes relay URL and open-tab status to Settings. This is the component prop call site required by T12b.
- `frontend/src/helpTopics.ts`, `helpTopics.test.ts`: background-session Help topic and topic-list expectation.
- `frontend/src/app.css`: cap/risk copy and Help-link presentation for the new Session section.

No fixtures or mocks changed outside the listed test files. `SettingsDialog.test.tsx` supplies the new required props through its test harness.

## Spec coverage

Requirement | Commit | Test
--- | --- | ---
Seven choices, default 2 min, mapping and formatting | None, requested | `keepAlive.test.ts`; `settingsStore.test.ts`
Old and invalid settings fallback; choice persists under a cap | None, requested | `settingsStore.test.ts`; `SettingsDialog.test.tsx`
Capability URL, 5-second request, unknown on HTTP/CORS/JSON failure | None, requested | `relayCapabilities.test.ts`
K-01 to K-07 text, risk, applies-to, Help link | None, requested | `SettingsDialog.test.tsx`; WebKit browser check

## Design decisions

- `KeepAliveChoice` | new `keepAlive.ts` | shares the seven values between storage and UI | reuses the existing settings store. Confidence HIGH.
- `fetchRelayCapabilities` | new `relayCapabilities.ts` | one `fetch` with `AbortController` | the browser already supplies both APIs. Confidence HIGH.
- `SettingsDialog` | modified existing component | owns Session copy and status | follows the existing native-select and Help-provider patterns. Confidence HIGH.
- Input to status: stored choice and fetched cap -> effective-value text; input to persistence: select change -> existing `saveTerminalSettings` -> local storage.
- Scope excludes T10 connection wiring, relay changes, transfer resume, and broad README updates assigned to T19b.

## Verification

- Focused T12b gate: `Test Files  4 passed (4)` and `Tests  43 passed (43)`.
- Full frontend suite: `Test Files  35 passed (35)` and `Tests  404 passed (404)`.
- WebKit existing Settings E2E: `2 passed (8.8s)`.
- WebKit browser through the built app, with mocked relay capability response: `WebKit: capped choice visible; 1 hour persisted after reload; background Help focused`.
- Build: `✓ built in 711ms`; exit 0. Vite emitted its existing 500 kB chunk warning.
- Lint: `> oxlint`; exit 0.
- Format: `All matched files use the correct format.`; exit 0.
- `rtk git diff --check`: exit 0.

## Self-review

- No change needed | HIGH | `frontend/src/components/SettingsDialog.tsx:114` | K-07 takes precedence and capped choices retain their stored value | tests cover both.
- No change needed | HIGH | `frontend/src/relayCapabilities.ts:15` | failed, malformed, and timed-out capability requests return `unknown` | tests cover each path.
- No debug output, dead code, new dependency, or intentional behavior change outside the Session section found.

## Unverified and Notes for the lead

- Real relay expiry and SSH session resume were not verified. T10 owns connection-time v2 gating and lifecycle; T12b only exposes preference and capability state.
- iOS VoiceOver, 200-percent zoom at 320px, and visual contrast on every theme were not manually checked.
- SUSPECTED adjacent issue: `frontend/src/helpTopics.ts` Clipboard copy still describes long-press dragging on the live terminal, while the accepted Select text design uses a read-only view. Left for the Help copy task.
- Existing dirty changes outside T12b remain untouched. No branch, commit, or stash was created.
