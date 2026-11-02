# T17: Short-landscape combined row

Building: a single top row for the active target, terminal keys, More keys, and Actions on a short landscape touch viewport; done means those controls remain operable and session state remains visible as text.

## Assumptions

- The visual viewport supplies both dimensions. Thresholds are strict: height `< 400` and width `> 600` CSS px. Confidence HIGH: `12` T17.
- The existing phone switcher serves landscape touch widths above 719px. Confidence HIGH: `10` L-10 calls for the same target control.
- The target's two visible halves may each ellipsize, while the accessible label and switcher retain the full target. Confidence MED: CSS middle truncation needs physical Safari review.

## Built and files changed

- `frontend/src/shortLandscape.ts:3`, `shortLandscape.test.ts:5`: threshold classifier and boundary cases.
- `frontend/src/viewportHeight.ts:22,48`, `viewportHeight.test.ts:102`: add visual width to `ViewportLike` and reuse the existing event and interval sampler. The test fixture is a type-only call site changed by the new required width.
- `frontend/src/App.tsx:169,399,868,886`: place the existing `KeyBar` between the target switcher and Actions when the viewport qualifies. Keep full target and state in the button name. This extends the existing phone switcher to short landscape widths.
- `frontend/src/app.css:1245`: one top row, a target capped at 35 percent, middle ellipsis, and the switcher and More keys panels below it.
- `frontend/e2e/key-bar.spec.ts:6,57`: real WebKit tests at 844x390 for the row, target, Actions, Disconnected, and transient Resuming text and label.

No dependency, branch, or commit added. Accepted worktree edits remain intact.

## Spec coverage

Requirement | Code | Test | Commit
--- | --- | --- | ---
Strict visual viewport threshold | `shortLandscape.ts:3` | `shortLandscape.test.ts:5` | None, instructed
Reuse visual viewport sampling | `viewportHeight.ts:48`, `App.tsx:399` | `viewportHeight.test.ts:102` | None, instructed
Combined top row, operable controls | `App.tsx:886`, `app.css:1245` | `key-bar.spec.ts:6` | None, instructed
35 percent target, full accessible name | `App.tsx:900`, `app.css:1261` | `key-bar.spec.ts:6` | None, instructed
Resuming and Disconnected text | Existing status logic, `App.tsx:900` | `key-bar.spec.ts:6,57` | None, instructed

## Design and self-review

- Reused `KeyBar`, `ActionsMenu`, phone switcher, `ViewportLike`, and `trackViewportHeight`. Confidence HIGH: the WebKit case uses the real app and SSH test server.
- The classifier reads `visualViewport` through the established sampler. Confidence HIGH: the width-without-event unit test passes.
- No change needed | LOW | The final diff has no T17 debug output or new dependency. `git diff --check` passed.
- Out of scope: native xterm selection handles, unrelated mobile tasks, and the relay and engine implementations.

## Verification

Test-first: the new unit file failed before implementation with `Failed to resolve import "./shortLandscape.js"`.

From `frontend/`, Node 26:

```text
rtk npm test -- src/shortLandscape.test.ts
Test Files  1 passed (1)
Tests  5 passed (5)

rtk npm test
Test Files  39 passed (39)
Tests  510 passed (510)

rtk npm run test:e2e -- e2e/key-bar.spec.ts --browser=webkit --reporter=line
11 passed (28.9s)

rtk npm run build
✓ built in 597ms

rtk npm run lint
> oxlint

rtk npm run format:check
All matched files use the correct format.

rtk git diff --check
(no output; exit 0)
```

The WebKit E2E connected to the test SSH server, operated the target and Actions, closed the socket to show `Disconnected`, and observed the transient `Resuming` label after transport loss. First full E2E run failed on an overly exact button-top assertion (`Received: 6` vs `<= 1`); the row-overlap assertion replaced it. A focused resuming run also found that the state ended before a second assertion; one mutation observation now checks its visible text and label together. Both corrected cases and the full suite passed.

## Unverified items

- Physical iPhone Safari landscape with keyboard, safe areas, zoom, and VoiceOver: no device available. Risk: visual viewport and CSS clipping may differ from Playwright WebKit.
- Other E2E suites and relay or engine gates: T17 changes only frontend layout and viewport sampling; the full frontend unit suite, build, lint, format, and key-bar WebKit suite passed.

## Notes for the lead

- The worktree already contained accepted edits in `App.tsx`, `app.css`, and `key-bar.spec.ts`; T17 built on them. The additional `viewportHeight.ts` and fixture edits are required to reuse the visual sampler with width.
- No adjacent defect was confirmed. The existing Vite build reports a chunk over 500 kB; T17 does not change bundling.
