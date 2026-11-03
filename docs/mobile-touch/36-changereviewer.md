# 36 Change re-review

## Change and intent

Scope: `fix/ios-copy-paste`, `HEAD` 2acb400 against the uncommitted working tree. The tracked diff touches 22 files, +1357/-787 lines, plus the untracked 1027-line `frontend/e2e/touch-editing.spec.ts`. The other untracked `docs/mobile-touch/` files are review history, not implementation. Change (stated SAFE SCOPE decision): make touch selection edit only verified text sent on the current command line, while preserving native copy/paste and desktop input.

The diff exceeds 800 lines. I reviewed hand-written input tracking, range mapping, edit byte generation, and session routing first. I then checked their tests and skimmed form attributes, CSS, help text, and documentation. Deleted `terminalSnapshot` code has no remaining callers.

## Verdict

**APPROVE**, confidence **HIGH** for the typed-text rule and byte routing. R1 from review 34 is fixed: `recordedPositions` checks the sent text against live cells, and `selectionEditBytes` rejects a selection beyond that span (`frontend/src/terminalTouch.ts:39-110`). The split-write regression at `frontend/e2e/touch-editing.spec.ts:868-890` asserts zero bytes for suggestion text and two DEL bytes for typed text. The previous reach-based code would permit the suggestion edit. No remaining change-related finding met the concrete-trigger threshold.

## Findings

| ID | SEVERITY | file:line | problem | trigger (input or state) | proposed fix | CONFIDENCE |
|---|---|---|---|---|---|---|
| None | | | | | | |

## Callers and sibling paths checked

Traced `App.sendInput` through `SshHandle.write`, `Terminal.onInput`, `noteSentInput`, `recordTypedText`, `bufferRange`, `selectionEditBytes`, and `sendRaw`. Checked key bar and paste callers, modifier bypass for generated edit bytes, QuickType target ranges, normal and alternate buffers, wrapped and wide characters, frozen rows, resize, inactive tabs, Tab/history/navigation invalidation, and the desktop `touchHost === false` path. The desktop e2e case at `frontend/e2e/touch-selection.spec.ts:280-289` checks that no editable layer is added.

## Not reviewed or verified

No physical iOS or Android device or live fish/zsh line editor was available. The test server echoes bytes, so browser tests do not prove shell-specific editing behavior. I did not rerun Playwright: it starts servers on ports 8787 and 4173, and the lead supplied no verbatim output for its reported 107 passes. I did not run `npm run build` because it writes generated files outside this report. No version-sensitive external API claim was needed.

## Check results

Run here in `frontend/` with Node 26.13.0:

- `npm test`, exit 0: `Test Files  39 passed (39)`; `Tests  553 passed (553)`.
- `npm run lint`, exit 0: `> oxlint` (no diagnostics).
- `npm run format:check`, exit 0: `All matched files use the correct format.`
- `npx tsc --noEmit -p tsconfig.json`, exit 0: no output.
