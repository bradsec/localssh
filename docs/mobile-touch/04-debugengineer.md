# Font family spacing defect

## Symptom and reproduction

Reported: changing the terminal font family sometimes increases row spacing on iPhone/iOS Safari. Expected: once a selected font loads, rows use that font's metrics without another selection. Actual under a delayed Fira Code download: rows stay at 19 px after the font loads and become 21 px only after selecting the same font again.

Run from `frontend/` with Node 26: `npm run test:e2e -- e2e/font-metrics.spec.ts --browser=webkit --reporter=line`. The regression test connects to the disposable test SSH server, blocks the Fira Code font request, selects Fira Code, releases the request, and compares row height with a manual reselection [frontend/e2e/font-metrics.spec.ts:10](../../frontend/e2e/font-metrics.spec.ts#L10). It uses a 390 × 844 touch viewport and iPhone user agent. Playwright WebKit runs on Linux, not an iPhone.

Environment: Linux 6.12.113+deb13-amd64 x86_64, Node v26.13.0, `@playwright/test` 1.64.1, `@xterm/xterm` 6.0.0. Reported iOS version, Safari version, onset, and preceding deploy or data change were not provided. The worktree was clean at capture. Branch creation failed with `fatal: cannot lock ref 'refs/heads/debug/font-family-line-height': unable to create directory for .git/refs/heads/debug/font-family-line-height`. No commit was made, as requested.

## Hypotheses

| ID | Hypothesis | Evidence for | Evidence against / deciding test | Result |
| --- | --- | --- | --- | --- |
| H1 | Web font loads after xterm measures fallback font. | Delayed request yields 19 px after load; selecting Fira Code again yields 21 px. xterm measures on font option changes [CharSizeService.ts:34](../../frontend/node_modules/@xterm/xterm/src/browser/services/CharSizeService.ts#L34). | Explicitly loading the font and reapplying options yields 21 px without reselection. | Confirmed, HIGH. |
| H2 | The fixed `lineHeight: 1.15` itself changes on font selection. | It scales measured character height [DomRenderer.ts:119](../../frontend/node_modules/@xterm/xterm/src/browser/renderer/dom/DomRenderer.ts#L119). | The option remains fixed [Terminal.tsx:93](../../frontend/src/components/Terminal.tsx#L93), while the same selected family measures 19 px, then 21 px. | Ruled out as cause, HIGH. |
| H3 | `document.fonts` `loadingdone` always signals the selected font's completion in WebKit. | An event callback repaired the Chromium repro. | WebKit still failed with `before: 19, after: 19, reselected: 21`; a targeted event counter stayed unset in one run. | Ruled out as a reliable fix, MED. |

## Root cause

- Trigger: selecting a bundled family starts an asynchronous CSS and font download [App.tsx:256](../../frontend/src/App.tsx#L256), [terminalFonts.ts:17](../../frontend/src/terminalFonts.ts#L17).
- Fault: Terminal sets `fontFamily` before the selected face has loaded [Terminal.tsx:188](../../frontend/src/components/Terminal.tsx#L188).
- Propagation: xterm measures on option changes, while font completion alone causes no guaranteed remeasurement. Its row height uses measured character height times `lineHeight` [CharSizeService.ts:34](../../frontend/node_modules/@xterm/xterm/src/browser/services/CharSizeService.ts#L34), [DomRenderer.ts:117](../../frontend/node_modules/@xterm/xterm/src/browser/renderer/dom/DomRenderer.ts#L117).
- Failure: the row keeps fallback metrics until another font option change. Font download timing explains the intermittent report.

## Fix

The live terminal now waits for its selected CSS and font face to load, then reapplies font options and refits [Terminal.tsx:193](../../frontend/src/components/Terminal.tsx#L193). It uses the existing two-frame iOS remeasurement path and cancels stale callbacks when settings change [Terminal.tsx:196](../../frontend/src/components/Terminal.tsx#L196). The new browser regression test covers the delayed font load [font-metrics.spec.ts:10](../../frontend/e2e/font-metrics.spec.ts#L10). Files changed: `frontend/src/components/Terminal.tsx`, `frontend/e2e/font-metrics.spec.ts`, this report. Commit: none, per task instruction.

## Verification

Before fix, focused WebKit repro: `{ before: 19, after: 19, reselected: 21 }`; `Expected: 21`, `Received: 19`; `1 failed`. The same result occurred with the event-only candidate. After fix, Chromium: `{ before: 19, after: 21, reselected: 21 }`; `1 passed (4.0s)`. WebKit: `{ before: 19, after: 21, reselected: 21 }`; `1 passed (4.6s)`. Repeated WebKit run: three identical measurements, `3 passed (4.6s)`. These finite runs do not prove zero intermittent failures.

Frontend unit baseline with Node 26:

```text
Test Files  31 passed (31)
     Tests  354 passed (354)
```

Frontend unit final with Node 26:

```text
Test Files  31 passed (31)
     Tests  354 passed (354)
```

`./node_modules/.bin/tsc -b --noEmit` exited 0 with no output. `oxfmt --check src/components/Terminal.tsx e2e/font-metrics.spec.ts` reported `All matched files use the correct format.` The initial attempt under Node v22.19.0 did not start tests: `~/.nvm/versions/node/v22.19.0/bin/node: bad option: --no-webstorage`. `frontend/package.json` requires Node `>=26 <27`.

## Sibling risks and limits

No separate caller of the font update helpers exists; both paths are used by Terminal [terminalFont.ts:39](../../frontend/src/terminalFont.ts#L39), [Terminal.tsx:186](../../frontend/src/components/Terminal.tsx#L186). No confirmed sibling defect. `S1 | SUSPECTED LOW | frontend/src/App.tsx:256 | the preload promise is not handled on font download failure | handle rejection separately if failure behavior becomes a task`. No font download failure was observed.

Actual iPhone Safari, other font families, slow or failed networks, and production sessions were not verified. The line-height setting was not added; that is separate work.
