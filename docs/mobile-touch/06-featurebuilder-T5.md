# T5 featurebuilder report

Building: phone session switching, compact controls, and drag-only scrolling for active SSH users; done means a 320px phone can switch sessions and use Actions without hidden gesture input.

Assumption: the existing tablist becomes a temporary `Open terminals` sheet only during an active phone session. The connect screen retains tabs so users can return to open sessions. Confidence HIGH from the T5 plan and existing tab semantics.

## Built

Requirement | File | Test
--- | --- | ---
Phone target opens switcher; choose, close, and add sessions | `frontend/src/App.tsx:564,595` | `frontend/src/App.test.tsx:170`; `frontend/e2e/key-bar.spec.ts:74`
Escape, outside tap, and Close dismiss; focus returns to target | `frontend/src/App.tsx:453,603` | `frontend/src/App.test.tsx:170`
44px target and Actions, bounded switcher, visual viewport and Files | `frontend/src/app.css:2353,2395` | `frontend/e2e/key-bar.spec.ts:74`
Phone drags never send hidden shell keys | `frontend/src/components/Terminal.tsx:151,293,365,450` | `frontend/e2e/key-bar.spec.ts:120`
Phone gesture legend and approved design delta | `frontend/src/components/TerminalSettings.tsx:115`; `DESIGN.md:42,53` | Source review

Reuse: the existing tablist, `ActionsMenu`, `KeyBar`, viewport lock, Files view, and xterm scroll method. No dependency or public API change. Desktop tabs and keyboard shortcut remain in place. No branch or commit, per task instruction.

## Verification

Test-first: the new `App.test.tsx` case failed with `Unable to find an accessible element with the role "button" and name /open terminals/i`, then passed after implementation.

Run from `frontend/` with Node 26.13.0:

```text
rtk npm test -- src/App.test.tsx
Test Files  1 passed (1)
      Tests  53 passed (53)

rtk npm test
Test Files  32 passed (32)
      Tests  362 passed (362)

rtk npm run build
✓ built in 186ms

rtk npm run lint
> oxlint

rtk npm run format:check
All matched files use the correct format.
```

All five commands exited 0. `rtk git diff --check` exited 0.

Required WebKit command: `rtk npm run test:e2e -- e2e/key-bar.spec.ts --browser=webkit --reporter=line` exited 1. Three T5 browser tests passed at 320px and 390px, including the no-hidden-input gesture test. The existing key bar test failed:

```text
Error: expect(locator).toContainText(expected) failed
Locator: locator('.xterm-rows')
Expected substring: "~"
Received string:    " "
Timeout: 5000ms
```

Diagnostic run showed `tap()` sent no WebSocket frame for Tilde; a temporary `click()` sent one. The diagnostic changes were removed. `KeyBar.tsx` is outside T5's write set, so this code conflict remains unfixed. Later attempts to run the required command stopped before tests with `Error: http://127.0.0.1:4173 is already used, make sure that nothing is running on the port/url or set reuseExistingServer:true in config.webServer.` No server or config was changed.

## Self-review and lead notes

T5-01 | HIGH | `frontend/src/components/KeyBar.tsx:83` | WebKit touch `tap()` does not send key-bar bytes; the required gate fails | Fix in a task whose write set includes `KeyBar.tsx`, then rerun WebKit.

No other finding in the T5 diff. Out of scope: direct selection on live xterm rows, relay resume, and changes to tablet or desktop gestures. Physical iPhone keyboard, safe areas, native selection handles, VoiceOver, zoom, and landscape remain unverified. Playwright WebKit on Linux cannot prove them.
