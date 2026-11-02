# Mobile touch debugging report

Date: 2026-11-02. Local environment: Linux x86_64, Node 22.19.0 in the default shell, Node 26.13.0 installed and used for unit tests. The worktree already contained accepted Phase 2 edits. No branch or commit was created, as requested. No deployment or data change was reported.

## Bug 1: WebKit touch key bar

**Symptom and reproduction.** From `frontend/`, run `rtk npm run test:e2e -- e2e/key-bar.spec.ts --browser=webkit --reporter=line`. The existing test at `frontend/e2e/key-bar.spec.ts:6` connects to the disposable test SSH server and taps Tilde. Before the fix:

```text
Expected substring: "~"
Received string:    " "
Timeout: 5000ms
  1 failed
  3 passed (14.2s)
```

Expected: one `~` reaches the terminal and the helper textarea retains focus. Actual: no `~` appears. A temporary event recorder logged `TILDE EVENTS [ 'pointerdown', 'pointerup' ]` in WebKit. The same tap in Chromium logged `pointerdown`, `pointerup`, `click`, and one WebSocket send. Recorder code was removed.

| ID | Hypothesis | Evidence for | Evidence against or deciding test |
| --- | --- | --- | --- |
| B1-H1, HIGH | Preventing pointer-down default suppresses WebKit's synthetic click; the key sends only on click. | WebKit delivered pointer events without click; `KeyBar.tsx:81-83` used `onClick` only. | Chromium still delivered click; the focused WebKit test passed after handling pointer release. |
| B1-H2, ruled out | T5 phone switcher or gestures intercepted the tap. | T5 changed `App.tsx`, `app.css`, and terminal gestures. | The target received pointer-down and pointer-up; `git show HEAD:frontend/src/components/KeyBar.tsx` matches the original key handler. |
| B1-H3, ruled out | The T4 text-view input guard dropped the byte. | `App.tsx:204` has a new guard. | No click or WebSocket send occurred before the callback could reach the guard. |

**Root cause chain.** Trigger: WebKit touch tap on a key-bar button. Fault: the button prevents pointer-down default but sends its key only from `click` (`frontend/src/components/KeyBar.tsx:81-83` before the fix). Propagation: WebKit emits pointer release without the synthetic click. Failure: `sendKey` is never called, so no `~` reaches xterm. This predates T5; the handler is unchanged in HEAD.

**Fix and regression test.** `frontend/src/components/KeyBar.tsx:69,86` now handles pointer release for keys and modifiers, and keeps `click` for non-pointer keyboard activation. This follows the existing keyboard toggle's pattern. The existing WebKit E2E case is the regression test; `frontend/e2e/key-bar.spec.ts:31` now also rejects a duplicate `~~`. It failed before the fix for the reported missing `~`.

After the fix:

```text
> playwright test e2e/key-bar.spec.ts --browser=webkit --reporter=line
Running 4 tests using 1 worker
  4 passed (9.2s)
```

## Bug 2: phone two-session test

**Symptom and reproduction.** From `frontend/`, run `rtk npm run test:e2e -- e2e/connect-flow.spec.ts --browser=chromium --grep "keeps two live terminal sessions" --reporter=line`. Before the test update:

```text
Error: locator.boundingBox: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('tab', { name: '127.0.0.1, connected' }).first()
  1 failed
```

The test successfully opened both sessions and selected the first before resizing to 390px. Expected under the approved design: the active phone session shows a target button, and its tablist appears when that button opens the switcher (`docs/mobile-touch/02-uiuxdesigner.md:54-56,121,136`). Actual: the test looked for a permanent tab row after resize (`frontend/e2e/connect-flow.spec.ts:312-315` before the update).

| ID | Hypothesis | Evidence for | Evidence against or deciding test |
| --- | --- | --- | --- |
| B2-H1, HIGH | T5 intentionally hides the tablist for an active phone session until the switcher opens. | `App.tsx:595` gates the tablist on `switcherOpen`; the approved spec says no permanent tab row. | Opening the switcher made both tabs and their close buttons visible; the revised test passed. |
| B2-H2, ruled out | A connection failed or the second tab disappeared. | The locator timed out. | Earlier `toHaveCount(2)` and terminal output assertions passed before the resize. |
| B2-H3, ruled out | T9 transport work changed session state. | T9 reported this failure. | `06-featurebuilder-T9.md` says T9 made no code changes; the failure follows the T5 UI condition. |

**Root cause chain.** Trigger: the test resizes an active two-session view below 720px. Fault: the test retains the pre-T5 permanent-tab assumption. Propagation: `App.tsx:595` correctly removes the tablist until the phone switcher opens. Failure: Playwright waits for a tab that is intentionally absent. This is a T5 behavior change and a stale test, not a product regression.

**Fix and regression test.** `frontend/e2e/connect-flow.spec.ts:312-328` now asserts the phone switcher target, asserts the tablist starts closed, opens it, checks both connected tabs and the 44px target, then closes the second session. No product code changed for Bug 2. After the update:

```text
> playwright test e2e/connect-flow.spec.ts --browser=chromium --grep keeps two live terminal sessions --reporter=line
Running 1 test using 1 worker
  1 passed (4.6s)
```

## Checks and lead notes

The earlier T5 report recorded a frontend unit baseline of `Test Files  32 passed (32)` and `Tests  362 passed (362)`. A full E2E baseline before these fixes was not run; the two targeted failures above were reproduced first. Final checks from `frontend/`:

```text
rtk npm run test:e2e -- --browser=chromium --reporter=line
  31 passed (20.2s)

rtk proxy npm run test:e2e -- --browser=webkit --reporter=dot
Error: browserContext.newCDPSession: CDP session is only available in Chromium
  1 failed
  30 passed (25.4s)

rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm test
 Test Files  32 passed (32)
      Tests  362 passed (362)

rtk npx tsc -b --pretty false
TypeScript: No errors found

rtk npm run lint
> oxlint

rtk npm run format:check
All matched files use the correct format.
```

The first `rtk npm test` attempt used Node 22 and ran no tests: `~/.nvm/versions/node/v22.19.0/bin/node: bad option: --no-webstorage`. The project requires Node 26 (`frontend/package.json:7`, `.nvmrc`); the Node 26 run passed. `rtk git diff --check` exited 0.

**Related finding.** R-01 | MED | `frontend/e2e/connect-flow.spec.ts:256` | The large-folder test unconditionally calls Chromium-only `newCDPSession`, so the full WebKit suite fails before testing that case | Make the CPU throttle optional or scope that case to Chromium in a separate task. This is not caused by either reported bug and was not changed.

**Sibling path.** The modifier buttons in `KeyBar.tsx:69` used the same click-only pattern; Bug 1's root fix covers them. The existing WebKit test taps Ctrl and passes. No other matching click-only key-bar path remains.

**Not verified.** Physical iPhone Safari, hardware keyboard, production relay data, and sustained load were not available in this local run. The targeted WebKit pass is a finite sample, not proof of zero intermittent failures. No commit hash exists because committing was explicitly prohibited.
