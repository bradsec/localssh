# Mobile touch recheck fixes

## Scope

Building: safe terminal swipes and host setting saves for phone users, done when phone landscape swipes send no shell input and reset waits for a pending host save.

No spec ambiguity. The accepted uncommitted Phase 2 work remained in place. No commit was made, as requested.

## Findings fixed

N1 | HIGH | `frontend/e2e/key-bar.spec.ts:315` failed before the fix: `Expected: 20`, `Received: 21` for an 844 × 390 touch swipe. `Terminal.tsx:282` checked width alone while `App.tsx:179-181` already defines phone mode as phone width or short touch landscape. `App.tsx:1131,1176` now passes that mode to each terminal. `Terminal.tsx:73-74,164,266,282` reads its latest value for both swipe paths and scrolling policy. The same e2e test passes before and after portrait rotation. Confidence HIGH: the real connected terminal sent one extra frame before the fix and none afterward.

N2 | MEDIUM | `frontend/src/components/SettingsDialog.test.tsx:217` failed before the fix: `expect(element).toBeDisabled()` received an enabled Apply to selector. During a pending appearance save, the scope selector and reset button could start a competing vault save. `SettingsDialog.tsx:224,341` now disables both until that save settles. The test verifies reset cannot start a second save, then succeeds after the first save completes. Confidence HIGH: the pending promise test exercised the reachable overlap and passed after the fix.

## Design and coverage

App phone mode | modified `frontend/src/App.tsx` | supplies the existing phone mode to both terminals | reuses the app's short landscape decision.

Terminal gesture policy | modified `frontend/src/components/Terminal.tsx` | reads the current phone mode during move and release | its gesture listeners remain mounted through rotation.

Settings save controls | modified `frontend/src/components/SettingsDialog.tsx` | blocks scope and reset while appearance save is pending | reuses `savingHostAppearance`.

Input paths: touch swipe -> App phone mode -> Terminal gesture policy -> no shell input; appearance change -> pending host save -> disabled scope/reset -> save completion -> reset permitted.

Out of scope: new gesture rules, vault serialization changes, new settings controls, physical device calibration. No README or API change was needed because user-facing behavior follows the existing phone and save rules.

## Checks

- N1 red, focused e2e: `1 failed`, with `Expected: 20` and `Received: 21`. Green: `1 passed (4.6s)`.
- N2 red, focused unit: `Tests  1 failed | 18 skipped (19)`. Green: `Tests  1 passed | 18 skipped (19)`.
- Frontend unit, `rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm test`: `Test Files  39 passed (39)`; `Tests  531 passed (531)`.
- Frontend typecheck, `rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npx tsc -b --pretty false`: exit 0, no output.
- Frontend lint, `rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm run lint`: exit 0, `> oxlint`.
- Frontend format check, `rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm run format:check`: `All matched files use the correct format.`
- Full frontend e2e, `rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH E2E_RELAY_PORT=18787 npm run test:e2e`: `48 passed (1.5m)`.
- Relay unit, `rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm test`: `Test Files  7 passed (7)`; `Tests  185 passed (185)`.
- Relay build, `rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm run build`: exit 0, `> tsc -p tsconfig.build.json`.
- Relay lint, `rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm run lint`: exit 0, `> oxlint src scripts test`.
- Engine, `rtk go test ./...`: `Go test: 126 passed in 5 packages`.
- `rtk git diff --check HEAD`: exit 0, no output.

## Notes for the lead

The first focused e2e attempt could not start its relay: `listen EADDRINUSE: address already in use 127.0.0.1:8787`. Both successful e2e runs used `E2E_RELAY_PORT=18787`. Playwright exited and cleaned up the relay and testsshd it started. No matching child remained after the full run.

The e2e build emitted an existing large-chunk warning. Physical iOS/Android touch behavior remains unverified. No adjacent source defect was confirmed or changed.
