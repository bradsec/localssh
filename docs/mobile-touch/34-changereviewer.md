# 34 Change re-review

## Change and intent

Scope: `fix/ios-copy-paste`, `HEAD` 2acb400 to the uncommitted working tree, plus untracked `frontend/e2e/touch-editing.spec.ts`. The tracked diff touches 22 files, +1278/-787 lines. Change (stated in the SAFE SCOPE decision): make touch selection edit the current command only where its cells are certain, with native copy and paste, while preserving desktop input.

The 39 unit files and the targeted e2e cases cover P1-P5 from review 32. P1's test draws a suggestion and restores the cursor in one terminal write. Xterm reports the final cursor position once per parsed chunk, so that test does not cover separate writes. P2's frozen/live row comparison, P3's column-change reset, P4's raw modifier path, and P5's session-input counter are present. The P3 and P4 tests were mutation-checked in step 33; P1 and P2 unit tests failed before their fixes, per that report.

## Verdict

**CHANGES REQUIRED**, decided by R1. Confidence **HIGH** in the byte path and **MEDIUM** in the end-to-end outcome: fish and zsh behavior is documented, but neither shell was run here.

## Findings

ID | SEVERITY | file:line | problem | trigger (input or state) | proposed fix | CONFIDENCE
---|---|---|---|---|---|---
R1 | HIGH | `frontend/src/components/Terminal.tsx:210-218`; `frontend/src/terminalTouch.ts:97-109` | `inputReach` advances on any parsed cursor movement, including a suggestion rendered by the shell. The later cursor-back write cannot lower it, so selection edit sends Right arrows into suggestion cells and deletes different command characters. | In fish, type `git ch`, then receive `eckout main` and a cursor-back sequence in separate terminal writes within `UNPROMPTED_OUTPUT_MS`. Select `eck` and press Backspace. The first of three Right arrows accepts the full suggestion; three DELs then remove `ain`, outside the selection. `editFor` reaches this path through `Terminal.tsx:254-265`; the one-write e2e at `frontend/e2e/touch-editing.spec.ts:868-885` misses it. | Extend `inputReach` only for verified command echo; fail closed when output alone advances it. Add a two-write e2e that asserts zero edit bytes for the suggestion. | HIGH for xterm event and emitted bytes; MED for shell outcome, based on fish 4.9.3 docs, not a live shell test.

Fish [interactive-use docs](https://fishshell.com/docs/current/interactive.html), version 4.9.3, accessed 2026-11-03, state that Right at line end accepts the entire autosuggestion. The [zsh-autosuggestions usage docs](https://github.com/zsh-users/zsh-autosuggestions), repository `master` as accessed 2026-11-03, describe the same `forward-char` behavior. Local `@xterm/xterm` 6 source at `frontend/node_modules/@xterm/xterm/src/common/InputHandler.ts:497` fires `onCursorMove` once after each parsed chunk when its final cursor differs; `WriteBuffer.ts:245` fires `onWriteParsed` after parsing. These support the split-write trigger. The exact installed zsh-autosuggestions version is unknown, so the finding uses fish as its concrete case.

## Callers and sibling paths checked

Traced `App.sendInput` through `Terminal.onInput`, `noteSentInput`, `sendRaw`, `selectionEditBytes`, and `SshHandle.write`; `ClipboardMenu` through `TerminalControls.paste`; native paste and `beforeinput` through `editFor` and `bufferRange`. Checked alternate buffer, wrapped rows, changed frozen rows, column resize, inactive tabs, selection replacement, and the desktop `touchHost === false` branch. P2-P5 have no remaining finding. Other touched form attributes, help text, CSS, and key-bar tests were skimmed for regressions. Deleted snapshot code has no remaining callers.

## Check results

Run here in `frontend/` with Node 26.13.0:

- `npm test`: `Test Files  39 passed (39)`; `Tests  549 passed (549)`.
- `npm run lint`: exit 0; output `> oxlint` with no diagnostics.
- `npm run format:check`: `All matched files use the correct format.`

The lead reported `tsc` ok, Chromium combined 100 passed, and WebKit touch suites 62 passed, but supplied no verbatim command output. Those results are not claimed as independently verified. I did not rerun e2e because it starts servers on ports 8787 and 4173. I did not run build or `tsc -b` because they can write outputs outside the requested report.

## Not reviewed or verified

No physical iOS or Android device, live fish/zsh session, native selection callout, IME, or QuickType run. The source and tests establish P1-P5 coverage; R1 needs the two-write regression test and a live shell check. Fix R1 belongs to the change author or debugengineer. No whole-repo finding was raised.
