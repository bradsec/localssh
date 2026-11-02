# T18b featurebuilder report

Building: one-tap Reconnect from the touch recovery row, for phone users whose session ended. Done means: with the vault unlocked and the tab's password saved there, Reconnect opens a new session in the same tab with no form; any other case opens the connect form with host, port and user already filled; success writes the faint marker line once.

## Assumptions

- A-1 | "the entry still exists" | The entry must also still store a password (`hasPassword`). Without one, a vault reconnect fails at the engine, so the form opens instead. HIGH.
- A-2 | Which address does an in-place vault reconnect use? | The tab's own host, port and user (what the user was connected to), with the vault entry supplying the password by `entryId`. An entry edited since the connection does not move the tab. MED.
- A-3 | Reconnect while another connection is in flight (`status` connecting or host-key prompt) | Opens the prefilled form instead of starting a second attempt. The form's Connect button stays disabled until the other attempt finishes. Starting a second attempt would supersede the first and leave its tab stuck as "Connecting". MED.
- A-4 | S-19 in the form path | A failed reconnect started from the form shows the error in the form, with the form still bound to the closed tab, so the user can correct the password and retry. A failed in-place reconnect shows the existing `ConnectionError` in the recovery row, with `Close terminal` and `Reconnect`. MED.
- A-5 | Declining a host key during a reconnect | Cancel on the host-key prompt returns the tab to S-15 instead of removing it, as happens for a new connection. For a changed key, the existing danger prompt still blocks, and nothing is trusted without the user's action. HIGH.
- A-6 | Prefilled form when the closed session used a private key | The form opens with Password selected and the password field focused. Only `{ host, port, username }` are carried over (the plan interface). The user can switch to Private key. MED.
- A-7 | When is the marker written? | Before the first output byte of the new session, or on success if no byte has arrived yet, and only once per successful reconnect. Resumes (`transport` connected) never write it. HIGH.

## Built

- `TerminalTab` gains `port`, `username`, `entryId?` (set only when `password.kind === "vault"`), plus `reconnecting?` and `reconnectError?`. Each attempt refreshes these fields from the values it used, so a reconnect through the form that changed the address retargets the tab.
- `reconnectTab(tab)` (`App.tsx`): with an unlocked vault, a matching entry with a saved password, and no other attempt in flight, it calls `attemptConnect({ host, port, username, password: { kind: "vault", entryId } }, tab)`. Otherwise it sets the pending reconnect and opens the connect view.
- Pending reconnect: a state value plus a ref. `ConnectDialog` gets `key={pendingReconnectId ?? "new"}` and `initialValues`, and `submitConnect` routes a submit into the pending tab. Choosing any tab, `New terminal`, or closing the tab clears it, so going back leaves the tab in S-15.
- S-16: while an in-place reconnect runs, the row shows `Connecting to <host>...` and `Cancel`. Cancel invalidates the attempt (`connectionAttemptRef`), and a session that arrives late is closed.
- `attemptConnect` now ignores `onClose`/`onTransportStatus` from an attempt that is superseded and never opened (`stale()`). Without this, the late session's close would have rewritten the cancelled tab.
- S-18: `RECONNECT_MARKER` is `\r\n ESC[2m[localssh] New connection. Output above is from the closed session. ESC[22m\r\n`, written through `controls.write` (or `pendingData` before the terminal is ready).
- Success clears `lostReason`, `lostWhileHidden`, `inputError` and `reconnectError` on the tab.
- Typed passwords and keys are never stored on the tab. Key bytes are zeroed on a failed reconnect, the same as on a failed new connection.
- `ConnectDialog`: an optional `initialValues` prop prefills host, port and user (it takes precedence over the legacy `lastHost` migration). On mount, focus goes to the first empty credential: Password when a user is set, else Username. Without the prop nothing changes; a test checks that focus does not move.
- `RecoveryRow`: optional `connectingTo`, `onCancel` and `error` props, plus `data-testid="recovery-row"`.

## Files changed

Product: `frontend/src/App.tsx`, `frontend/src/components/ConnectDialog.tsx`, `frontend/src/components/RecoveryRow.tsx`.
Tests: `frontend/src/App.test.tsx`, `frontend/src/components/ConnectDialog.test.tsx`, `frontend/e2e/connect-flow.spec.ts`.

Outside the plan's file list:
- `RecoveryRow.tsx`: S-16 and S-19 render inside the row, and the row is T18a's component. This is required by the plan interface ("S-16 shows `Connecting to <host>...` with Cancel. S-19 shows the error with Retry.").
- `App.test.tsx` now mocks `./vault/useVault.js`. The mock passes through to the real hook unless a test overrides it, so existing tests run against the real hook as before.

No fixtures and no type-only call sites changed. No commit, no branch.

## Tests added

App (`src/App.test.tsx`, `describe("one-tap Reconnect")`, touch phone):
- `reconnects in place from the unlocked vault and marks the new output once`: vault password by `entryId`, no form, S-16 text and Cancel, key bar returns, one tab, the marker appears exactly once and before the new output, and a later `connected` transport status adds no second marker.
- `opens a prefilled form when the vault is locked, then replaces the tab in place`: form prefilled, password focused, no connect call; the typed submit replaces the tab (still one tab) and writes the marker.
- `opens a prefilled form after a typed password and never reuses it`: host, port and user filled, password empty and focused.
- `opens a prefilled form after key authentication`.
- `leaves the closed tab in recovery when the user goes back from the form`: S-15 again; `New terminal` afterwards shows an empty form.
- `still blocks a changed host key on a vault reconnect`: the `Host key changed` prompt shows, `trustHostKey` is not called, Cancel returns to the recovery row, and no marker is written.
- `shows a failed reconnect in the recovery row and retries` (S-19).
- `cancels a reconnect in progress and closes the late session`.

ConnectDialog (`src/components/ConnectDialog.test.tsx`):
- `prefills host, port and user for a reconnect and focuses the password`
- `focuses the username when a reconnect has none`
- `does not move focus without initial values`

E2E (`e2e/connect-flow.spec.ts`, `one-tap Reconnect on a phone`, 390px with touch): `Reconnect after an expired session with a typed password shows the prefilled form`. The test starts its own relay with `KEEPALIVE_MAX_SECONDS=1` and points page sockets at it. It types output, dispatches `pagehide`, closes the socket, waits 2.5 s, then dispatches `pageshow`. The test then checks, in order:
- `Session expired.` shows.
- After Reconnect, the form has host, port and user filled, the password is empty and focused.
- After the password is submitted, the key bar returns, the old output and the marker line show in `.xterm-rows`, and there is one tab.

Red first: before implementation, 7 of the 8 App tests and 2 of the 3 ConnectDialog tests failed (`Tests 7 failed | 66 passed (73)`). The go-back test already passed, because T18a's Reconnect opened the form.

## Checks and results

All commands ran in `frontend/` with Node 26.13.0 on PATH.

```text
npm test -- src/App.test.tsx src/components/ConnectDialog.test.tsx
      Tests  91 passed (91)
```

```text
npm run test:e2e -- e2e/connect-flow.spec.ts --browser=webkit --reporter=line
  1 skipped
  20 passed (58.6s)
```
(The skip is the existing `test.skip(browserName !== "chromium", "CDP is Chromium only")` at `connect-flow.spec.ts:1161`.)

```text
npm run test:e2e -- e2e/connect-flow.spec.ts --browser=chromium --reporter=line -g "expired session"
  1 passed (8.9s)
npm run test:e2e -- e2e/key-bar.spec.ts --browser=webkit --reporter=line
  6 passed (21.2s)
```

V-FE:

```text
npm test
 Test Files  35 passed (35)
      Tests  438 passed (438)
npm run build
✓ built in 189ms
npm run lint
> oxlint            (no findings)
npm run format:check
All matched files use the correct format.
```

## Self-review

- R1 | MED | `App.tsx` attemptConnect `stale()` | The guard also applies to new-tab attempts that are superseded and never opened. Before, their late `onClose` could toast "Session ended" and, on desktop with one tab, clear the tab list. | Kept: it applies only to attempts already superseded, whose handle is closed on arrival. Recorded as a behavior change below.
- R2 | LOW | `App.test.tsx` | A `capGraceMs` field was missing from a test literal, which broke `tsc -b` (the unit tests do not type-check) | fixed.
- R3 | LOW | `connect-flow.spec.ts` | `relay.kill("SIGTERM")` on the npm wrapper orphaned the relay | fixed: detached process group plus SIGKILL in `finally`.
- No debug output, commented-out code, or single-caller abstraction added.

## Unverified

- Real iPhone Safari: VoiceOver reading of `Connecting to <host>...` (a `role="status"` paragraph), and keyboard behavior when the password field takes focus on the prefilled form. Only WebKit/Chromium emulation ran.
- The in-place vault path end to end: E2E would need a vault with a master password and a saved entry. App tests cover it with a mocked `useVault`.
- S-19 and Cancel in a browser; App tests only.

## Notes for the lead

- Behavior change (R1): `onClose`/`onTransportStatus` from a superseded, never-opened attempt are now ignored for all connections, not only for reconnects.
- On touch, after an expiry, `Session expired.` appears twice: in the T10 `ConnectionError` alert above the terminal and in the recovery row's network cause line. T18a already noted the same duplication.
- SUSPECTED adjacent problem (engine, T8): `resumeState.retry` (`engine/wsconn/wsconn.go:893-935`) keeps retrying after the relay answers `expired`. It fails only when the local grace runs out, so a relay restart or an evicted session shows `Resuming` for up to the full grant, for example 2 minutes. The E2E works around this with a 1 s relay cap. Not fixed.
- SUSPECTED adjacent problem (relay scripts): this is the likely cause of the orphaned 8787 relay T18a reported. In `relay/scripts/run-local-relay.ts:27-38`, the first SIGTERM calls `relay.close()` and waits. The process stayed alive while live sessions remained, and a second SIGTERM killed it, because the handler is registered with `once`. Playwright's global teardown and the two existing v2 tests (`relay.kill("SIGTERM")` on npm) leave relays behind this way. I observed this in each run and stopped only the processes those runs left. No relay processes remain. Not fixed.
- `trustAndRetry`'s catch (a `trustHostKey` storage failure) still removes the tab, including a reconnecting one. This is pre-existing behavior; I left it unchanged.
