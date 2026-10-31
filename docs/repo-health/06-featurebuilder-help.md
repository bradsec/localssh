# H1 In-app Help and connection recovery

Built 2026-11-01 on `review/2026-10-31`. The worktree was clean at entry. No commit, branch, tag, or push was made: the lead commits.

## 1. Spec read and assumptions

Building: searchable in-app Help and typed connection recovery for LAN SSH users. Done means Help opens from the connect screen, a live session, and each recovery point, and every specified failure shows a recovery step with a Help link.

Lead decision (recorded): the relay's pre-upgrade HTTP rejections (403 origin, 503 session limit) stay unchanged as a security control. H1c is narrowed. A failed WebSocket upgrade maps to one "Could not reach the relay" message that lists three causes (relay down or wrong address, origin refused, session limit), a fix for each, and a Help link. Failures after the socket opens get typed variants.

Assumptions:
- Help is a modal dialog, not the earlier `<details>` dropdown. Learn more opens it from inside the host-key prompt, so it must sit above that modal. It is portalled to `body` because the toolbar's `z-index: 4` stacking context would keep it below the prompt.
- Network drop: a session that ends without an SSH `exit-status` or `exit-signal` (RFC 4254 6.10) counts as lost. A server that closes the channel without either shows "connection lost". No real server doing this was tested.
- The unknown variant moves `{reason}` out of the sentence into Technical details, so the raw text does not appear twice.
- Copy beyond the deck is written in its voice: the target-not-allowed, host-not-found, timeout, refused, host-key, and connection-lost variants, the cause list, search empty state, result count, "Learn more", "Technical details", "Search help", and "Close".
- The deck's known-host storage variant is not mapped, because H1c does not list it. That error falls to the unknown variant, with the raw text kept in Technical details.

## 2. Spec coverage

| Requirement | ID: files changed | Test |
| --- | --- | --- |
| H1c relay: typed close reasons after upgrade (not found, refused, timeout, unreachable, error) | R1: `relay/src/local-relay.ts`, `relay/src/local-relay.test.ts`, `relay/README.md` | `closes with a typed reason when the target fails with %s` (7 cases), `names a target deadline...`, `reports a refused target port through a real connection` |
| H1c engine: relay close reason reaches the error text | E1: `engine/wsconn/wsconn.go` | e2e `explains a refused connection...` (asserts `target connection refused` in the detail). There is no wasm unit harness. |
| H1c engine: tell a clean exit from a network drop | E2: `engine/sshclient/client.go`, `engine/sshclient/testserver.go`, `engine/sshclient/client_test.go`, `engine/main.go`, `frontend/src/ssh/engine.ts` | `TestExitReportedAfterTheShellExits`, `TestExitNotReportedWhenTheConnectionDrops` (race, 30 runs), App `explains a dropped session...`, `returns ... without an error when the shell exits` |
| H1c frontend: mapping to deck variants, raw detail kept | F1: `frontend/src/connectionErrors.ts`, `connectionErrors.test.ts`, `components/ConnectionError.tsx`, `components/ConnectDialog.tsx`, `App.tsx`, `app.css` | 14 raw-string cases plus the cause-list test. App tests `turns a relay close reason...` and `lists every likely cause...`. e2e refused and auth tests |
| H1a Help content ships with the app, sectioned, searchable | F2: `frontend/src/helpTopics.ts`, `helpTopics.test.ts` | Topic list matches the deck. Search tests cover case, every-word matching, and no match |
| H1a dialog: both screens, focus kept, Escape, a11y, phone | F3: `frontend/src/components/Help.tsx`, `Help.test.tsx`, `App.tsx`, `app.css`, `README.md`, `frontend/e2e/help.spec.ts` | 10 Help unit tests. App `opens Help during a session without ending it`. e2e: connect screen, live session with terminal refocused and typing working, 320x568 phone bounds. Existing 320/390/1440 checks |
| H1b shared open-at-topic plus Learn more links | F4: `frontend/src/helpContext.ts`, `Help.tsx` (`HelpProvider`, `LearnMore`), `HostKeyPrompt.tsx`, `SavedHosts.tsx`, `ClipboardMenu.tsx` and their tests | Host-key both variants. Vault unlock and reset. App tests for Help over the host-key prompt (Tab stays in Help, prompt survives Escape) and for a blocked copy (menu and staged text kept, focus returned) |

## 3. Design decisions

- Help reuse | `Help.tsx` extended, no parallel component | HIGH, the old Help was replaced in place.
- Relay reasons map from `error.code`, never `message`, following the Node v26.13.0 errors doc. Reasons stay under 123 bytes and never echo the host | HIGH.
- `wsconn.CloseError` wraps `io.EOF`, so `errors.Is(err, io.EOF)` callers are unchanged. It is recorded only for closes the peer started (`closedLocally` guard) | HIGH.
- `Session.ExitReported()` waits for the request goroutine after `Close`, so a buffered `exit-status` cannot lose a race with channel EOF. The 30-run race stress passed | HIGH.
- `onClose(reason)` is additive. engine.ts treats a missing reason from an older cached wasm as "" | HIGH.
- Mapping is substring patterns over the raw text, in a fixed order. The contract phrases are listed at the top of `connectionErrors.ts` | MED. It is a text contract across three packages, and the tests pin each phrase.
- `LearnMore` renders nothing outside a provider, so 49 standalone component renders stay unchanged | MED. A missing provider would hide links silently. App tests and e2e cover the real tree.
- Focus return goes to the element focused before the Help press. During a session that is the terminal textarea, which e2e verified. It falls back to a closed menu's summary, then the Help button. A pending return is cancelled on reopen and on unmount, which fixed a test flake | HIGH.
- `HostKeyPrompt` trap stands down while focus is inside another `aria-modal` | HIGH.
- Clipboard menu ignores outside events from `[data-help-dialog]`. Help's Escape calls `stopPropagation`, which a unit test verified | HIGH.
- Phone and iOS keyboard: the panel's height comes from `--app-height` (visual viewport) and its offset from `--app-viewport-offset`. The search input is 16px via `.field`, and targets are at least 44px | MED, no physical device was used.
- Out of scope: no change to pre-upgrade 403/503, no known-host storage variant, no keepalive for silent drops, no K1/F1/T1.

Self-review: no HIGH or MED findings left. Fixed during review: LOW, `Help.tsx` stale rAF focus steal (cancel on open and unmount); LOW, dead `.help summary` CSS selectors removed, `.help__trigger` keeps the phone padding.

## 4. Verification evidence

- Engine: `Go test: 57 passed in 4 packages`; `GOOS=js GOARCH=wasm go vet ./...` exit 0; `built dist/engine.wasm, dist/wasm_exec.js, dist/testsshd`. Race stress: `Go test: 60 passed in 1 packages`.
- Relay: `Test Files  4 passed (4)`, `Tests  47 passed (47)`; lint exit 0; format `Finished in 4ms on 12 files`; build exit 0.
- Frontend: `Test Files  29 passed (29)`, `Tests  285 passed (285)` on 6 consecutive runs; oxlint exit 0; `All matched files use the correct format.`; tsc exit 0; `✓ built in 155ms`.
- Playwright, using the real relay, wasm engine, and test sshd: `18 passed (5.6s)`, including the 5 new `help.spec.ts` tests. A refused dial to 127.0.0.1:1 showed "The server refused the connection." with `target connection refused` in Technical details. Learn more focused "Fix a connection problem". A wrong password showed "SSH login failed."
- `git diff --check` clean.

## 5. Out of scope and adjacent problems

- SUSPECTED: a silent network loss (Wi-Fi drop, no TCP reset) may leave a session looking connected until the browser times out the WebSocket. Neither side runs a keepalive.
- Risk: the typed relay reasons tell any allowed origin whether a target name resolves, refuses, or times out. Timing already gives a client this. `ALLOWED_HOSTS` still bounds the targets. The lead should accept this or reject it.
- Vite still reports a chunk above 500 kB. This existed before this change.

## 6. Not verified

- Physical iOS and Android: on-screen keyboard over Help search, focus return raising the keyboard, and safe areas. Chromium emulation only.
- Screen reader traversal (VoiceOver, NVDA). Only roles and names were asserted.
- Origin-refused and session-limit paths end to end. They share the unchanged generic upgrade error, and the mapping is unit-tested.
- The host-not-found and unreachable reasons against real DNS and routing. Unit tests inject the error codes.
- Docker images: not built in this step.
