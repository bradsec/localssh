# T18a featurebuilder report

Building: a Resuming state, a recovery row in place of the key bar, and Select text on closed tabs, for phone users whose session drops. Done means: on touch, a closed active tab shows the cause line, the tmux hint (background loss only), `Close terminal` and `Reconnect` where the key bar was, and Select text still opens.

## Assumptions

- A-1 | What is "the existing retry path" for Reconnect? | The tab stores no credentials, so `attemptConnect(values, retryTab)` cannot run unaided. Reconnect calls `selectTab(null)`, which opens the connect form and keeps the closed tab in the list. T18b replaces this. MED.
- A-2 | Cause mapping | `lostWhileHidden` gives `background`; any close reason gives `network`; a clean close with no reason (shell exit) gives `server`. `user` stays in the prop type, but Disconnect removes the tab, so no current path renders it. MED.
- A-3 | Desktop (plan A-03) | Desktop keeps the HEAD close handling exactly: if it was the only tab, the app returns to the connect form, with an error when a reason exists; if other tabs exist, a clean exit removes the tab; if other tabs exist and a reason exists, the tab stays as Disconnected. HIGH: the two pre-existing tests for that behavior pass again.
- A-4 | Does a clean shell exit on touch keep the tab? | Yes. `10` S-04 (rev) says "Session closed for any reason" leads to the recovery row. MED.

## Built

The previous attempt left `RecoveryRow.tsx`, the KeyBar `disabled` prop, the Resuming status text, the `Back in session.` announcement, the B-06 guard change, and four App tests. That attempt also removed the desktop close handling: `explains a dropped session...` and `returns to the connect form...` failed, along with its own three recovery tests. Its tests used `usePhoneScreen()`, which does not match `(pointer: coarse)`, so neither the key bar nor the row rendered. This run corrected both problems and finished the task:

- `frontend/src/App.tsx` (`onClose`, about line 380): on touch, keeps the closed tab and sets `lostReason`. Other pointers restore the HEAD branches.
- `frontend/src/App.tsx` (about line 927): renders the key bar while the tab has a handle, and `RecoveryRow` once it has none. Reconnect calls `selectTab(null)` and Close calls `closeTab`. The previous attempt wrote this code; this run left it unchanged.
- `frontend/src/components/RecoveryRow.tsx`: the buttons use the existing `.button` / `.button--primary` classes.
- `frontend/src/app.css`: new `.recovery-row` styles, appended at the end of the file. Cause line 15/22, muted hint 13/18, safe-area padding, 44px buttons with primary on the right. `flex-wrap: wrap-reverse` puts Reconnect on top if the buttons stack (`10` 4.4).
- `npm run format` (oxfmt) rewrapped the previous attempt's unformatted lines in `App.tsx`, `KeyBar.tsx` and `App.test.tsx`. Line wrapping only.

## Files changed

Product: `frontend/src/App.tsx`, `frontend/src/components/RecoveryRow.tsx` (new), `frontend/src/components/KeyBar.tsx` (`disabled` prop, from the previous attempt), `frontend/src/app.css`.
Tests: `frontend/src/App.test.tsx`, `frontend/e2e/key-bar.spec.ts`.
No fixtures, mocks or type-only call sites changed. No commit, no branch.

## Tests added

App (`src/App.test.tsx`; new helper `useTouchPhone()` matching coarse pointer and phone width):
- `shows recovery after background loss and lets a closed tab select text`: S-15 background cause, tmux hint, key bar gone, Select text on the closed tab (B-06).
- `shows network recovery without the background hint and keeps focus on return`: network cause, no hint, focus unchanged.
- `announces resuming and return without moving focus`: S-13 `Resuming`, Keyboard hidden, keys `aria-disabled`; S-14 `Back in session.` in a polite live region; focus unchanged.
- `keeps a touch tab after the shell exits and shows the server cause`: server cause, switcher shows `Disconnected`, polite `Terminal for <target> disconnected.`
- `closes the terminal from the recovery row`.
- `opens the connect form from Reconnect and keeps the closed tab`.

E2E (`e2e/key-bar.spec.ts`, 390px, touch, keep-alive Off through localStorage so a closed socket ends the session):
- `replaces the key bar with the recovery row after network loss`
- `replaces the key bar with the recovery row after background loss`

Each test checks: the row replaces the key bar, the switcher shows `Disconnected`, the tmux hint appears only for the background cause, both buttons are at least 44px tall and inside 390px, and Select text opens on the closed tab with the earlier output.

Before the fix, the three recovery App tests and the two desktop tests failed (`Unable to find ... "Reconnect"`, `... "Escape"`, `... /^connect to server$/i`).

## Checks and results

All commands ran in `frontend/` with Node 26.13.0 on PATH.

```text
npm test -- src/App.test.tsx
      Tests  65 passed (65)
```

```text
npm run test:e2e -- e2e/key-bar.spec.ts --browser=webkit --reporter=line
  6 passed (21.2s)
npm run test:e2e -- e2e/key-bar.spec.ts --browser=chromium --grep "recovery row" --reporter=line
  2 passed (16.1s)
```

V-FE:

```text
npm test
 Test Files  35 passed (35)
      Tests  427 passed (427)
npm run build
✓ built in 186ms
npm run lint
> oxlint            (no findings)
npm run format:check
All matched files use the correct format.
```

## Self-review

- R1 | MED | `App.tsx` onClose | The previous attempt removed the desktop close behavior (a silent change outside the spec) | fixed: the touch-only branch is gated on `touchPointer`.
- R2 | MED | `App.test.tsx` | The recovery tests never rendered the touch UI | fixed: `useTouchPhone()`.
- R3 | LOW | `RecoveryRow.tsx` | The buttons were unstyled | fixed: existing button classes plus new CSS.
- No debug output, commented-out code or single-caller abstraction found.

## Unverified

- Real iPhone Safari: background loss, VoiceOver announcements, the 320px button stacking. Only WebKit/Chromium emulation ran, at 390px.
- The E2E covers neither the S-13 Resuming state nor the server cause (shell exit). The test sshd only echoes and has no shell exit. App tests cover both.

## Notes for the lead

- On touch, a generic loss shows `The connection to the server was lost.` twice: once in the existing `ConnectionError` alert above the terminal (`App.tsx` `activeTab?.lostReason`), and once in the recovery row. I kept the alert because it carries the raw detail, Help, and the T10 `Session expired.` copy. Hiding it on touch would be a separate decision.
- A touch shell exit now keeps the tab with the server cause instead of returning to the connect form (A-4, `10` S-04 rev). Desktop is unchanged.
- SUSPECTED adjacent problem: after Chromium E2E runs, the global-setup relay on 8787 stayed alive as an orphan (PPID 3310). It happened twice, and it blocked the next run with `EADDRINUSE`. I stopped only the PIDs those runs left (3290038 and 3293769). Ports 8787 and 4173 are free now. I did not trace the cause in `playwright/global-setup.ts`.
