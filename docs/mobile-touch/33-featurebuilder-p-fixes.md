# 33 Fixes for re-review 32 (P1-P5)

Step 33 answers [32-changereviewer.md](32-changereviewer.md). The SAFE SCOPE
rule from [31](31-featurebuilder-safe-scope.md) still holds: a selection edit
acts only where the typed command is certain and sends nothing otherwise.
Branch `fix/ios-copy-paste`, uncommitted. Date: 2026-11-03.

## Coverage

ID | Status | Change | Test
---|---|---|---
P1 | Fixed | Terminal tracks `inputReach`, the furthest cell the xterm cursor has reached since `inputStart`, through `term.onCursorMove`. It is kept as a marker and column, set with `inputStart`, and cleared with it. `selectionEditBytes` ends the input at the earlier of `typedEnd` and that reach, so text drawn after the cursor (a fish or zsh-autosuggestions suggestion, a right prompt padded with written spaces) is not input. Without a reach, only text before the cursor counts. | Unit "never treats an autosuggestion drawn after the cursor as input" (`git ch` + `eck`: selecting `eck` sends nothing; selecting `ch`..`eck` sends DEL x2; no reach sends nothing). E2E "an autosuggestion drawn after the cursor is never deleted as input" (suggestion drawn then cursor moved back; `eck` + Backspace sends nothing; `ch` + Backspace sends exactly DEL DEL).
P2 | Fixed | `bufferRange` compares the text of every frozen row the range touches (non-breaking spaces normalised, trailing blanks trimmed) with the live line's `translateToString(true)`. Any difference returns null, so nothing is sent. | Unit "maps a range in the mirrored rows..." (changed live row returns null). E2E "a selection over a row that changed after it froze sends nothing" (select `lo` in `hello`, a late echo redraws `helXlo`, Backspace sends nothing).
P3 | Fixed | `term.onResize` clears `inputStart` and `inputReach` when the column count changes. | E2E "a column change forgets the tracked command input".
P4 | Fixed | Test only. | E2E "tablet key bar › a selection edit skips an armed Alt, which stays armed": arms Alt, Backspace over selected input sends arrows and DEL with no ESC prefix, Alt stays pressed, and the next `q` sends `ESC q`.
P5 | Fixed | `key-bar.spec.ts` "phone drags send no hidden shell keys" and "swipes stay silent in phone landscape and after rotation to portrait" now count writes to the SSH session (`countSessionInput`, hooking `sshConnect` like `touch-editing.spec.ts`) instead of every WebSocket frame. | Both tests `--repeat-each=20`: 40 passed in plain mode and 40 passed with `E2E_COMBINED=1`.

The P3 and P4 e2e tests were checked against a temporary revert of their fixes
(resize clear disabled, raw flag disabled): both failed, then the code was
restored. The P1 and P2 unit tests failed before the code changes.

`selectMirrorText` in `touch-editing.spec.ts` now selects across the text
nodes of one row, because xterm draws the cursor cell in its own span.

## Files

- `frontend/src/terminalTouch.ts`: `inputReach` clamp, frozen-row text check.
- `frontend/src/components/Terminal.tsx`: `inputReach` tracking via
  `onCursorMove`, clear on column change.
- `frontend/src/terminalTouch.test.ts`, `frontend/e2e/touch-editing.spec.ts`,
  `frontend/e2e/key-bar.spec.ts`.

## Checks

Run in `frontend/` with Node v26.13.0:

- `npm test`: `Test Files  39 passed (39)`, `Tests  549 passed (549)`
- `npx tsc -b`: no errors
- `npx oxlint`: exit 0
- `npm run format:check`: `All matched files use the correct format.`
- `npx playwright test` (Chromium): 100 passed
- `npx playwright test e2e/touch-editing.spec.ts e2e/touch-selection.spec.ts e2e/key-bar.spec.ts --browser=webkit`: 62 passed
- `E2E_COMBINED=1 npx playwright test`: 100 passed

Leftover relay and test sshd processes were killed by PID after each run. The
`run-all-in-one.js` process with cwd `/app` (a Docker container) was left
alone.

## Open risks

- MED: xterm fires `onCursorMove` once per parsed chunk with the final cursor
  position. If a shell's suggestion and its cursor-back sequence arrive in
  separate chunks, the reach includes the suggestion. fish and
  zsh-autosuggestions were not run; the e2e test sends both in one write.
- LOW: after the user moves left and inserts, the shifted tail past the old
  reach is clamped off, so fewer selected characters are deleted. This fails
  safe.
- LOW: a frozen row with invisible or underlined blank cells renders
  differently from `translateToString`; such a row fails the P2 check and
  sends nothing. This fails safe.
- Device behaviour remains unverified, as in docs 29 to 31.
