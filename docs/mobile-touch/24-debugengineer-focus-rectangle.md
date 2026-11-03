# Focus rectangle on the iPhone terminal prompt

## Symptom and reproduction

Release v2026.11.02, iPhone Safari: first login shows an indigo rectangle around the prompt row. Expected: only the terminal cursor indicates focus. Actual screenshot: `briefs/rectangle-1d33090c.png`. The report provides no device version or earlier onset date. Local checks used Linux x86_64, Node v26.13.0, `@xterm/xterm` 6, and Playwright's Chromium and WebKit with a 390 × 844 mobile touch viewport.

Run from `frontend/` with Node 26 on `PATH`:

```sh
rtk npx playwright test e2e/touch-selection.spec.ts --grep 'terminal input has no visible focus decoration' --browser=chromium
rtk npx playwright test e2e/touch-selection.spec.ts --grep 'terminal input has no visible focus decoration' --browser=webkit
```

The test connects to the disposable E2E SSH server, focuses xterm's helper textarea, checks its outline, shadow, and opacity, then verifies a regular button retains its keyboard focus ring. Before the fix, Chromium reported:

```text
Locator:  locator('.terminal-host--touch .xterm-helper-textarea')
Expected: "none"
Received: "solid"
1 failed
```

WebKit also failed the outline assertion before the fix (`Expected: true`, `Received: false`).

## Hypotheses

| ID | Hypothesis | Evidence for | Evidence against or deciding test | Result |
| --- | --- | --- | --- | --- |
| H1 | Global `textarea:focus-visible` outline draws the rectangle. | `frontend/src/app.css:149-157` sets a 3px outline; `:631-640` makes the row-wide helper opaque. Chromium computed `outline-style: solid` before the fix. | The focused-helper test fails in both browsers before the fix and passes after suppressing its outline. | Confirmed, high confidence for the CSS defect. |
| H2 | A box shadow draws the rectangle. | Shadows can draw around focused fields. | The post-fix test computes `box-shadow: none` in Chromium and WebKit; no helper shadow rule exists. | Ruled out for tested browsers. |
| H3 | Border, appearance, autofill, selection, or text scaling draws the rectangle. | The helper is now opaque, exposing any native decoration. | xterm 6 CSS sets `border: 0`; local CSS sets transparent text, background, and caret. No helper autofill or appearance rule exists. The global `::selection` is intentional selection styling; text size adjustment applies to `html` and `body`. The outline-only fix clears the reproduction. | Unsupported as the rectangle's cause; real iPhone rendering unverified. |

## Root cause and fix

1. Trigger: touch terminal connects and focuses xterm's helper textarea (`frontend/e2e/touch-selection.spec.ts:28`).
2. Fault: the global focus selector gives that textarea a 3px solid outline (`frontend/src/app.css:149-157`).
3. Propagation: the touch rule keeps the textarea opaque and stretches it across the cursor row (`frontend/src/app.css:631-640`).
4. Failure: the browser paints the outline as the reported prompt-row rectangle.

Added `outline: none` only to the touch helper rule (`frontend/src/app.css:638`). The rule keeps opacity, geometry, and the text layer intact. The regular button still computes a 3px solid focus outline. Regression test: `frontend/e2e/touch-selection.spec.ts:28-47`. Changes remain uncommitted on `fix/ios-copy-paste` per lead instruction; no commit hash exists.

## Checks

| Check | Before | After |
| --- | --- | --- |
| Focus regression, Chromium | `1 failed`, received `solid` | `1 passed (5.7s)` |
| Focus regression, WebKit | `1 failed`, outline assertion | `1 passed (6.0s)` |
| `rtk npm test` | `Test Files  40 passed (40)`; `Tests  540 passed (540)` | `Test Files  40 passed (40)`; `Tests  540 passed (540)` |
| `rtk npx tsc -b` | Not run | Exit 0, no output |
| `rtk npx oxlint` | Not run | Exit 0, no output |
| `rtk npm run format:check` | Not run | `All matched files use the correct format.` |
| `rtk npx playwright test --browser=chromium` | Not run | `66 passed (1.5m)` |
| `rtk npx playwright test e2e/touch-selection.spec.ts --browser=webkit` | Not run | `15 passed (25.8s)` |
| `rtk git diff --check` | Not run | Exit 0, no output |

`npm test` printed `Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package` in both runs; all 540 tests passed. The first format check found the new test unformatted. Targeted `oxfmt` fixed it, and the final check passed. Playwright emitted Vite chunk-size and `NO_COLOR` warnings but passed. No relay or `testsshd` process remained after E2E runs.

## Siblings and limits

No confirmed sibling defect. Desktop's helper remains at xterm's opacity 0, and the touch fix does not change desktop CSS. Other controls retain the shared focus rule.

Actual iPhone Safari paint, iOS keyboard behavior, and production terminal themes were not checked. Playwright WebKit checks computed styles and touch behavior, not a physical iPhone. The pre-existing untracked `docs/mobile-touch/24-researchanalyst-ios-text-editing.md` was left untouched.
