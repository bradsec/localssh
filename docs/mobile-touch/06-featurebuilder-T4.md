# T4 featurebuilder report

Building: a read-only Select text view for phone SSH users; done means either entry path freezes the active terminal buffer in selectable DOM text, blocks input, and clears on close.

Assumption: the visible phone control sits over the terminal viewport. T5 owns the later compact control layout. No spec conflict found. Confidence HIGH: T2 already exposes `TerminalControls.snapshotText()`.

## Built

Requirement | File | Test
--- | --- | ---
Frozen active-tab snapshot, blur, input block, close | `frontend/src/App.tsx:124,198,401,682` | `frontend/src/App.test.tsx:157`; `frontend/e2e/touch-selection.spec.ts:20`
Visible Select text entry | `frontend/src/App.tsx:684` | `frontend/src/App.test.tsx:157`; `frontend/e2e/touch-selection.spec.ts:20`
Stationary long-press entry | `frontend/src/components/Terminal.tsx:338` | `frontend/src/App.test.tsx:184`; `frontend/e2e/touch-selection.spec.ts:50`
Selectable DOM text and close control | `frontend/src/App.tsx:693`; `frontend/src/app.css:572` | `frontend/e2e/touch-selection.spec.ts:20`
Clear on tab or SSH close | `frontend/src/App.tsx:301,418` | `frontend/src/App.test.tsx:184,200`

Design: reuse T2's active-buffer snapshot. Keep xterm mounted, so SSH output and its scroll position continue behind the view. Use a `pre` with browser selection. No new dependency or wire format. Existing Clipboard remains.

Files changed: `frontend/src/components/Terminal.tsx`, `frontend/src/App.tsx`, `frontend/src/app.css`, `frontend/src/App.test.tsx`, `frontend/e2e/touch-selection.spec.ts`. The report is this file. No commit, per task instruction.

## Checks

Command | Exact result
--- | ---
`rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm test -- src/App.test.tsx` | `Test Files  1 passed (1)`; `Tests  52 passed (52)`
`rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm test` | `Test Files  32 passed (32)`; `Tests  361 passed (361)`
`rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm run test:e2e -- e2e/touch-selection.spec.ts --browser=webkit --reporter=line` | `2 passed (6.3s)`
`rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm run build` | `✓ built in 186ms`
`rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm run lint` | Exit 0; `> oxlint`
`rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm run format:check` | `All matched files use the correct format.`

Initial test-first run could not reach tests because the shell selected Node 22: `node: bad option: --no-webstorage`. The project uses Node 26; all later checks used the installed v26.13.0. Thus a red test result for the new behavior was not observed. The first WebKit run failed because Playwright cannot fill xterm's hidden textarea; the test now focuses it and types through the keyboard.

## Self-review and notes for lead

R1 | MED | `frontend/src/App.tsx:301` | Remote SSH close left the snapshot open and could block later input | Clear view in `onClose`; added `frontend/src/App.test.tsx:200`.

No further finding. Direct xterm row selection remains outside T4. The T4 view does not alter T5's phone gesture contract. Existing font work in `Terminal.tsx` and parallel relay edits were left intact.

Unverified: physical iPhone Safari handles and system Copy; Linux Playwright WebKit verifies DOM selection but cannot prove the iOS selection menu. Browser clipboard transfer was not asserted. A physical Safari release gate remains required.
