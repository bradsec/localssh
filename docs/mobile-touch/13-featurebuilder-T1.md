# T1 featurebuilder report: persistent line-height preference

Building: a persisted terminal line height for browser SSH users. Done means choosing a value in Appearance changes row spacing and the PTY size live, and the value survives a reload.

Status: built. Not committed (lead instruction).

## Spec read and assumptions

- Source: `12-implementationplanner-amended.md` T1, lead decision (default 1.15, range 1.0 to 2.0, step 0.05, persisted, applied live), `08` line 58 (two-decimal labels), `08` line 82 (field name `Line height`).
- The picker sits after Font size in the existing Appearance panel, as T1 states. The Settings dialog belongs to T12a.
- JSON cannot carry `NaN` (`JSON.stringify(NaN)` writes `null`), so the store test covers its serialized form `null`. The validator also rejects non-finite numbers through `Number.isFinite`.

## Built

- `TerminalSettings.lineHeight: number`. `loadTerminalSettings()` accepts finite numbers in [1, 2] that lie on a 0.05 step (tolerance 1e-9), snaps them to the exact twentieth, and otherwise falls back to `1.15`. Other fields keep their own validation, so a bad line height does not reset font size.
- `LINE_HEIGHT_MIN`/`LINE_HEIGHT_MAX` exported from the store. The picker uses them.
- Appearance panel: a `Line height` select after Font size with 21 options, `1.00` to `2.00`, value and label both `toFixed(2)`.
- `TerminalProps.lineHeight`. The constructor uses the prop instead of the hard-coded `1.15`. A separate effect sets `term.options.lineHeight` and refits on the next frame through the same `fitAndRefresh` (fit keeping selection, then refresh) that the font effect uses. `fitAndRefresh` moved from inside the font effect to component scope so both effects share it. The effect does not rebuild xterm. The uncommitted font fix (`applyFontOptionsAcrossFrames`, delayed-font remeasure) keeps its behavior.
- `App.tsx`: both `<Terminal>` sites pass `lineHeight={terminalSettings.lineHeight}`. The existing `updateTerminalSettings` saves it.

## Files changed

- `frontend/src/storage/settingsStore.ts`: interface, defaults, validation, exported bounds.
- `frontend/src/storage/settingsStore.test.ts`: tests (below). Existing fixtures gained `lineHeight`. `afterEach` now clears `localStorage`.
- `frontend/src/components/Terminal.tsx`: prop, constructor option, live effect, shared `fitAndRefresh`.
- `frontend/src/components/TerminalSettings.tsx`: Line height select.
- `frontend/src/App.tsx`: two `<Terminal>` props.
- `frontend/src/components/toolbarLabels.test.tsx`: fixture gained `lineHeight: 1.15`. The type change broke this fixture, and the plan's write set lists it.
- `frontend/e2e/font-metrics.spec.ts`: new test appended. The existing delayed-font test is unchanged.

## Tests added

- Store (`settingsStore.test.ts`): settings saved before the field existed load as 1.15 and keep `fontSize: 16`; `null`, `0.9`, `2.5`, `"1.2"`, `1.33` are rejected; bounds `1` and `2` are accepted; `1.35` round-trips through save and load; the blocked-storage default includes `lineHeight: 1.15`.
- E2E (`font-metrics.spec.ts`, "line height applies live, refits the PTY and survives reload"): an init script wraps `window.sshConnect` and records each `handle.resize(cols, rows)` call. While connected the test checks the picker shows `1.15`, chooses `1.50`, then asserts that the `.xterm-rows` row height grows and the last PTY `rows` shrinks. It reloads and reconnects (host key already trusted), then asserts the row height and PTY rows equal the live values and the picker shows `1.50`.
- Red evidence: the store tests failed before implementation (`expected undefined to be 2` and similar, 6 of 11 failing). The E2E web server build failed on the missing type. To show the E2E checks the behavior, I disabled the `term.options.lineHeight = lineHeight` line temporarily. The E2E then failed with `Expected: > 18, Received: 18`. I restored the file from a copy and confirmed that no probe text remains.

## Checks (Node 26.13.0 on PATH)

- `npm test -- src/storage/settingsStore.test.ts`: `Test Files 1 passed (1)`, `Tests 11 passed (11)`.
- `playwright test e2e/font-metrics.spec.ts --browser=webkit --reporter=line`: `2 passed (6.1s)`. The delayed-font test logged `{ before: 19, after: 21, reselected: 21 }`.
- The same spec on chromium: `2 passed (5.4s)`.
- V-FE:
  - `npm test`: `Test Files 32 passed (32)`, `Tests 371 passed (371)`.
  - `npm run build`: `built in 180ms`, no errors.
  - `npm run lint` (`oxlint`): exit 0.
  - `npm run format:check`: FAIL, but only on `e2e/connect-flow.spec.ts`, which T1 does not touch (see Notes). It failed before this task too: `oxfmt --check e2e/connect-flow.spec.ts` exits 1. My one format issue, in `settingsStore.test.ts`, I fixed with `oxfmt`.
- Full E2E suite, for context:
  - webkit: `32 passed`, `1 failed`. The failure is `connect-flow.spec.ts:435`, `browserContext.newCDPSession: CDP session is only available in Chromium`. That test is in `HEAD` and is Chromium-only.
  - chromium: `32 passed`, `1 failed`. The failure is `connect-flow.spec.ts:6`, `Error: v2 relay exited: 1`. That is the half-applied T8 resume E2E that the plan names.
  - Neither failure involves T1 files.

## Unverified

- Real iPhone Safari: I tested only Playwright WebKit with the iPhone viewport and UA. The live line-height path does not use the small-screen iOS family toggle, because xterm re-measures cell height when `lineHeight` changes. I have not checked this on a device.
- The `NaN` input itself (JSON cannot carry it). Covered through `null` and `Number.isFinite`.

## Notes for the lead

- V-FE `format:check` stays red until the accepted uncommitted `e2e/connect-flow.spec.ts` (T8 work) is formatted. I did not reformat it: the file is outside T1's write set and holds someone else's in-progress work.
- Adjacent, not fixed: the existing `connect-flow.spec.ts:435` test calls `newCDPSession` with no browser guard, so it always fails under `--browser=webkit`. The test is in `HEAD`.
- Adjacent, not fixed: `connect-flow.spec.ts:6` (T8 resume E2E) fails on chromium because the v2 relay exits with code 1. This matches the plan's note that T8 is half-applied.
- LOW, kept: the picker computes its option count with the factor `20`, which also exists as a private constant in the store. I exported only the bounds, to keep the store's public surface small.
