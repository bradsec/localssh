# 32 Change re-review: safe-scope selection edits (step 31)

Reviewer: changereviewer. Date: 2026-11-03. Scope: `git diff HEAD` on
`fix/ios-copy-paste` (HEAD 2acb400) plus untracked
`frontend/e2e/touch-editing.spec.ts`; 22 tracked files, +1150 / -764. Prior
review: [30-changereviewer.md](30-changereviewer.md) (N1-N7). Fix report:
[31-featurebuilder-safe-scope.md](31-featurebuilder-safe-scope.md). No project
files were changed. Proof tests and an instrumented copy of the flaky e2e test
ran from the session scratchpad only.

## 1. Change and intent

Change (stated, doc 31 and the user's SAFE SCOPE decision): touch selection
delete or replace acts only where the typed command is certain, which means
`inputStart` to the end of typed text, on the primary buffer, across autowrap
continuations only. Anything uncertain sends nothing. Selection-edit bytes skip
armed key-bar modifiers. The frozen mirror maps through an xterm marker.
QuickType `insertReplacementText` deletes its target range first. Multi-line
pasted commands are out of scope, and the docs say to use Backspace or Ctrl+U.

## 2. Verdict

**CHANGES REQUIRED**, confidence MED-HIGH. Decided by P1 (HIGH). P2 (MEDIUM) is
a second wrong-deletion path with a narrow trigger.

N1, N3, N4, N5, N6, and N7 are fixed, and each has a test that fails without
its fix. N2 is scoped out, and the docs match. The QuickType and raw paths
send no doubles. The new `typedEnd` rule still treats any characters drawn
right after the cursor as typed input. Shells draw autosuggestions there, and
in those shells Right arrow accepts the suggestion. A selection that reaches
into the suggestion therefore deletes characters the user did not select. That
is the failure the safe scope rules out.

## 3. Findings

ID | SEVERITY | file:line | problem | trigger (input or state) | proposed fix | CONFIDENCE
---|---|---|---|---|---|---
P1 | HIGH | frontend/src/terminalTouch.ts:44-60, 91 | `typedEnd` extends the input over every contiguous character after the cursor. fish (by default) and zsh-autosuggestions draw the suggested completion in exactly those cells, with no gap. Right arrow at end of line accepts the whole suggestion in both shells (fish documents Right/Ctrl+F; zsh-autosuggestions lists `forward-char` in its default accept widgets). After the first arrow the cursor sits at the end of the accepted text, so the DELs delete from there. Proof (fake term `$ git checkout`, typed `git ch`, cursor col 8, select cols 10-14): `\x1b[C` x6 + DEL x4; select cols 6-14: `\x1b[C` x6 + DEL x8. Doc 31 lists the written-space right prompt as an open risk; it is the same hole. | fish: type `git ch`, suggestion `eckout main` shows. Select `eck` and press Backspace (or Paste or type over it). Bytes are 3 right arrows and 3 DELs. The first arrow accepts `git checkout main`, and the DELs delete `ain`, which the user did not select. `eck` stays. | Clamp the input end to the furthest cell the xterm cursor has reached since `inputStart` (track it with `term.onCursorMove`, reset with `inputStart`). Text drawn beyond that cell was never typed at the cursor. If the user moved left and inserted, a clamp that is too short only deletes fewer selected characters, which is safe. Add unit and e2e tests with a suggestion drawn after the cursor (save cursor, write, restore). | HIGH (bytes proved); MED (shell reaction from fish and zsh-autosuggestions docs, not run)
P2 | MEDIUM | frontend/src/terminalTouch.ts:109-135 with :91-100 | While a selection exists the mirror rows are frozen, but `bufferRange` maps the DOM text offset onto the live `getLine(bufferRow)` (:120), and `selectionEditBytes` counts live cells. If the input row changed after the freeze, the offsets land on different characters. The marker (N6) fixes row identity, not row content. | Link with 0.5-1 s RTT (under the 1 s clear): type `hello`, Left, Left, `X`, then long-press `lo` before the echo arrives. The echo redraws `helXlo`. Backspace maps cols 3-5 to `Xl` and deletes those, not `lo`. | Before sending, compare each frozen row's text in the range with the live line's `translateToString(true)` and return null on any difference. Add an e2e test that writes to the session after selecting and asserts nothing is sent. | MED (traced; not run)
P3 | LOW | frontend/src/components/Terminal.tsx:150-182 | `inputStart.col` is a plain number. The marker follows reflow when the column count changes, but the column does not, so after a rotation the start can point into the prompt. A delete then still clamps at line start, which is safe. An insert or paste over a prompt-only selection lands at the input start instead of at the cursor. | iPad rotation within 1 s of typing, with a prompt long enough to wrap at one width. Readline's SIGWINCH redraw usually comes more than 1 s after the last key and clears `inputStart`, which keeps this rare. | Clear `inputStart` in the `onResize` handler when `cols` changes. | MED
P4 | LOW | frontend/src/App.test.tsx:1840-1854 | The N5 test proves only that App honours `raw`. Nothing checks that Terminal marks selection-edit bytes raw (`sendRaw`, Terminal.tsx:134-140). Removing `rawInput = true` keeps every test green. | Code reading. | Add an e2e test: arm Alt, select input, press Backspace, and assert the bytes have no ESC prefix and Alt stays armed for the next key. | HIGH
P5 | LOW | frontend/e2e/key-bar.spec.ts:315-390 | Test defect, not a product defect. The test counts every WebSocket frame, including the engine's SSH transport frames (`[2,"data","client",2796..3000,...]`) and flow-control acks (`[2,"ack","server",3064]`), which keep arriving after `.xterm-screen` is visible. An instrumented copy logged frames around the swipe in 40 runs. Every extra frame was one of those transport frames, sent before `--swipe start` or after `--swipe end`, and never a frame inside the synchronous swipe dispatch. It failed in this review's Chromium (non-combined) run at line 358 (18 vs 20), so it is not specific to combined mode. | Any run where the handshake tail outlasts the visibility check: 6 of 40 instrumented runs showed a difference. | Count only input frames, by hooking `SshHandle.write` or filtering `"data","client"` frames that start after the swipe. Or wait until the frame count is stable before taking the baseline. | HIGH

## 4. Prior findings N1-N7

ID | Status | Evidence
---|---|---
N1 | Fixed, except P1 | Autowrap-only rows (terminalTouch.ts:88-90) and the gap-ended `typedEnd`. Unit tests "never treats a right prompt as input", "never treats a completion listing printed after Tab as input", and "sends nothing when a hard row break lies between the input start and the cursor" fail on the step-29 code (my step-30 proofs are the same cases). E2E tests for the right prompt, completion listing, and wrapped command are present.
N2 | Scoped out | `\r` still clears. README.md:612-613, USER-GUIDE.md:112, and helpTopics.ts:65 now say multi-line commands are edited with Backspace or Ctrl+U. E2E "a selection across a hard row break of a multi-line command sends nothing".
N3 | Fixed | `buffer.type === "alternate"` returns null (terminalTouch.ts:85), and `noteSentInput` records no start there (Terminal.tsx:180). Unit and e2e tests present.
N4 | Fixed | Terminal.tsx:273-284: delete over a non-input selection sends nothing; insert and Enter release the selection and go to the cursor. E2E "typing goes to the cursor", "Enter over an output selection drops it and runs the command".
N5 | Fixed | `sendInput(data, raw)` skips `applyModifiers` (App.tsx:316-324); see P4 for the test gap.
N6 | Fixed for row identity | The `top` marker follows trimming and is dropped on buffer switch; the unit test maps with a frozen top that differs from the viewport. Row content drift remains (P2).
N7 | Fixed | No `pan-y` left in app.css.

## 5. New paths checked

- Raw path: `sendRaw` sets a flag around a synchronous `term.input`; xterm
  fires `onData` synchronously inside it, so only the edit bytes are raw. The
  inserted text that follows takes the armed modifier as intended. Paste after
  a replace is not raw, as at HEAD.
- QuickType: collapsed `insertReplacementText` sends `edit + data` only when
  `editFor(target)` returns bytes, otherwise nothing; the event is cancelled, so
  no `input` follows. One send per event; no double. With a non-collapsed DOM
  selection the replacement uses the DOM selection, not the target range; when
  that selection is outside the input the replacement text is sent at the
  cursor without deleting (consistent with N4, not a double).
- Paste: the replace bytes go raw, then one `term.paste`, then release; native
  paste stays cancelled in the capture phase.
- Typeahead before a prompt is drawn (`inputStart` set in output, prompt drawn
  on the same row after tty echo): left arrows only overshoot and clamp, so
  deletes are safe; an insert over the echoed typeahead lands at the input
  start. Not raised; same class as P3.
- `registerMarker(viewportY - baseY - cursorY)` (terminalTouch.ts:237) gives
  the absolute viewport line (`CoreBrowserTerminal.ts:948-949`); markers follow
  trim and insert (`Buffer.ts:627-639`).
- Desktop: `touchHost` false leaves `textLayer` null; `editFor` returns null;
  `onInput(data, raw)` defaults `raw` false. Desktop e2e passes.

## 6. Check results

Run in `frontend/` with Node v26.13.0:

- `npm test`: `Test Files  39 passed (39)` / `Tests  548 passed (548)`
- `npx tsc -b`: `TypeScript: No errors found`, exit 0
- `npx oxlint`: exit 0, no output
- `npm run format:check`: `All matched files use the correct format.`
- `npx playwright test` (Chromium): 95 passed, 1 failed:
  `key-bar.spec.ts:358` `Expected: 18` / `Received: 20` (P5)
- `npx playwright test e2e/touch-editing.spec.ts e2e/touch-selection.spec.ts e2e/key-bar.spec.ts --browser=webkit`: `58 passed (42.6s)`.
  A first WebKit attempt aborted in global setup with `listen EADDRINUSE:
  address already in use 127.0.0.1:8787` because the previous run's relay was
  still up; it was killed and the rerun passed.
- `E2E_COMBINED=1 npx playwright test e2e/key-bar.spec.ts -g "swipes stay silent in phone landscape" --repeat-each=40`: `40 passed (9.4s)`.
- Instrumented copy of that test, 40 runs: 6 runs showed extra frames, all SSH
  transport `data`/`ack` frames outside the swipe dispatch (P5).
- Proof test (scratchpad `proof32.test.ts`, the repo's `fakeTerm`): both cases
  fail as expected:

```
SUGGEST "\u001b[C" x6 + "<DEL>" x4
SPAN    "\u001b[C" x6 + "<DEL>" x8
```

After each e2e run the relay it started (cwd `relay/`)
was killed. `run-all-in-one.js` processes that predate the runs were left alone.

## 7. Not reviewed or not verified

- No physical device; callouts, caret drags, keyboard, IME, QuickType event
  shape on iOS, VoiceOver, and TalkBack remain unverified (doc 31 open risks).
- fish, zsh, bash, and vim were not run; their reactions come from their
  documentation. The e2e sshd echoes only.
- xterm `isWrapped` behaviour under readline redraws was not traced; doc 31
  argues a cleared flag now fails safe, which holds for the gate at
  terminalTouch.ts:88-90.
- No web lookup was made in this step.

Route P1-P4 to the change author or debugengineer, and P5 to whoever owns the
key-bar e2e suite.
