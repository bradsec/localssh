# 30 Change re-review: editable touch surface after step 29 fixes

Reviewer: changereviewer. Date: 2026-11-03. Scope: `git diff HEAD` on
`fix/ios-copy-paste` (HEAD 2acb400) plus untracked
`frontend/e2e/touch-editing.spec.ts`. 22 tracked files, +974 / -753, plus a
694-line spec. Prior review: [28-changereviewer.md](28-changereviewer.md).
Fix report: [29-featurebuilder-fixes.md](29-featurebuilder-fixes.md). No
project files were changed; proof tests ran from the session scratchpad only.

## 1. Change and intent

Change (stated, docs 25-29): on coarse-pointer devices the mirrored xterm rows
become one `contenteditable="plaintext-only"` host so native selection, Copy,
and Paste work on the live terminal; typed text, IME, Enter, Backspace, and
paste reach the shell once; selection edits (Backspace, typing, or Paste over
selected command input) replay through the line editor, now across rows (D2);
paste drops the highlight (D1); step 29 also claims F1-F11 fixed.

## 2. Verdict

**CHANGES REQUIRED**, confidence MED-HIGH. Decided by N1 and N3 (HIGH, wrong
deletions or input sent to the wrong place, proved by byte output) and N2
(HIGH, the D2 multi-row fix cannot run for a real multi-line command).

The F1-F11 fixes hold: each has a test that fails without it (section 4). The
remaining defects are in the new `inputStart` gate. It accepts text that is not
the line editor's buffer, so the fallback "extra arrows and DELs that readline
clamps at the line start" in doc 29 does not hold. A right arrow at end of line
is a no-op, so the DELs then delete unselected input, and an insert or paste
lands at line start instead of at the cursor.

## 3. Findings

ID | SEVERITY | file:line | problem | trigger (input or state) | proposed fix | CONFIDENCE
---|---|---|---|---|---|---
N1 | HIGH | frontend/src/terminalTouch.ts:65-80 | The gate admits any selection from `inputStart` to the last character anywhere on or after the input rows (`inputEnd` scan :67-73 covers every row to `buffer.length` and every column). Text on those rows that the line editor does not hold passes. Examples: a right prompt, autosuggestion text, and a completion listing printed within 1 s of Tab. Proof (fake-term unit test, scratchpad): RPROMPT gives `\x1b[C` x5 + DEL x5; a Tab listing gives `\x1b[D` x13 + DEL x3. | (a) zsh with `RPROMPT='%T'`, type `git status`, select the clock `12:34`, press Backspace: 5 right arrows are no-ops at end of line, then 5 DELs delete `tatus`. (b) bash: type `ls /e`, Tab Tab (listing within 1 s, prompt redrawn below), select `etc` in the listing, choose Paste (the D1 flow) or type a letter: left arrows overshoot to line start and the paste or letter lands before `ls`. | Gate on what the line editor can hold. Require every row from `inputStart.row + 1` to the cursor row to be `isWrapped` (or the selection to be on the cursor's wrapped run). End `inputEnd` at the first never-written cell after the cursor instead of scanning to the buffer end. Add unit tests for both triggers. Correct the doc 29 "clamps at the line start" claim. | HIGH (bytes proved); MED (zsh RPROMPT cell layout assumed: never-written gap)
N2 | HIGH | frontend/src/components/Terminal.tsx:162 | `noteSentInput` clears `inputStart` when the sent data contains `\r`. xterm turns every pasted newline into `\r` (`node_modules/@xterm/xterm/src/browser/Clipboard.ts:14`) before bracketing it. A pasted multi-line command, the only realistic way readline holds a hard row break, therefore always leaves `inputStart` null, and every selection edit in it sends nothing. The e2e test reaches the multi-row state only by writing `\r\n` from the server side (`e2e/touch-editing.spec.ts:478-482`), so it does not cover this path. README.md:612, USER-GUIDE.md:112, and helpTopics.ts:65 promise edits "across the lines of a multi-line command". | Doc 29 device step 2: paste `echo a`, newline, `echo bb` from Notes (bracketed paste), select `a` through `echo b`, press Backspace: nothing is sent. Typing `x` after the paste then sets `inputStart` at the end, so no selection in the pasted text ever edits. | Treat `\r` inside `\x1b[200~...\x1b[201~` as buffer content, not as Enter. Clear only on a `\r` outside a bracketed paste. Add an e2e test that pastes two lines through `term.paste` and then edits across them. Otherwise drop the multi-line claim from README, USER-GUIDE, and Help. | HIGH
N3 | HIGH | frontend/src/components/Terminal.tsx:160-166, 175-177; frontend/src/terminalTouch.ts:65 | `onBufferChange` clears `inputStart`, but the next printable byte in the alternate screen sets it again, and `selectionEditBytes` never checks the buffer type. In full-screen editors, cursor keys do not cross lines the way readline's linear buffer does. Proof: rows `abc`/`def`, cursor at end of `def`, select `b`: bytes `\x1b[D` x5 + DEL. | vim, `i`, type `abc` Enter `def`, select `b`, press Backspace. Insert-mode Left stops at column 0 (default `whichwrap=b,s`), so the DEL with `backspace=eol` joins the lines (`abcdef`) and `b` stays. The user selected one character and lost a newline. | Return null from `selectionEditBytes` (or skip `noteSentInput`) while `term.buffer.active.type === "alternate"`. Add a unit test. | HIGH (bytes and gate traced); MED (vim reaction from its documented defaults, not run)
N4 | MEDIUM | frontend/src/components/Terminal.tsx:253-264 | With any non-collapsed selection that is not inside the input, every `beforeinput` is cancelled and nothing is sent: letters, Enter (`insertParagraph`), and Backspace. Paste still works. No feedback is shown. iOS keeps an editable selection highlighted after Copy, so the next keystrokes vanish until the user taps elsewhere. Help says only "selected output cannot be deleted". | Select output, choose Copy, press Return on the soft keyboard to run the typed command: nothing happens. | For inserts and line breaks over a non-input selection, collapse the selection (`releaseSelection`) and send the text at the xterm cursor, as paste does. Keep the block only for `delete*`. Add an e2e test for Enter after an output selection. | MED (code path HIGH; iOS selection persistence after Copy not checked on a device)
N5 | LOW | frontend/src/App.tsx:315 with Terminal.tsx:229, 261 | Selection-edit bytes go through `term.input` and then `sendInput`, so an armed key-bar Alt prefixes ESC to the whole arrow and DEL run. | Arm Alt (once), select `b` in `abc` with the cursor at the end, press Backspace: `\x1b\x1b[D\x1b[D\x7f` reaches bash as ESC ESC (complete), literal `[D`, Left, DEL. Text is inserted and `b` stays. | Disarm or bypass modifiers for synthesised edit bytes (send them through a path that skips `applyModifiers`), or apply Alt only to the inserted text. | MED
N6 | LOW (SUSPECTED) | frontend/src/terminalTouch.ts:97 | While a selection exists the mirror is frozen, but `selectedBufferRange` maps rows with the live `viewportY`. If output scrolls the viewport during the selection, the range maps to rows one or more below what the user selected. | A selection made within 1 s of the last key while output arrives (a background job, slow echo), then Backspace. | Record `viewportY` when the mirror freezes and map with that value; drop the edit if the buffer was trimmed since. | LOW
N7 | LOW | frontend/src/app.css:602 | `touch-action: pan-y` on the host has no effect: the effective value is the intersection with the ancestor `.terminal-host` `touch-action: none` (:573), and no scroll container lies between them. It suggests the browser pans over the host, which would fire `pointercancel` and end every scroll gesture. | Code reading. | Remove the declaration, or state in a comment that the host inherits `none` on purpose. | MED

## 4. Prior findings F1-F11

ID | Status | Evidence
---|---|---
F1 | Fixed | Terminal.tsx:298-313 leaves 229, `Dead`, `Unidentified`, `Process`, and Alt+printable on a Mac platform to the browser. Test "Option characters reach the shell once through text input" stubs `MacIntel` before load and asserts `defaultPrevented` false; it fails if the Alt clause is removed. "Alt with a letter keeps xterm's Escape prefix off Mac platforms" guards the non-Mac path.
F2 | Fixed | `isCharacter` skips width-0 cells; unit test "counts a wide character once, not per cell" fails on the old per-cell count.
F3 | Fixed | `attachGestures` tracks host touches without `preventDefault` or capture (`nativeTouch`); the separate one-pointer mirror scroll is gone. Restored tablet test in `touch-selection.spec.ts:233` asserts Tab sent, no cancel, no capture, selection stand-down, and pointercancel. Real iOS caret drags remain unverified (doc 29 open risk).
F4 | Fixed | Host `focus`/`blur` listeners (Terminal.tsx:330-337); test "native blur and focus keep the key bar keyboard toggle in step" fails without them.
F5 | Fixed | Range end clamped to `inputEnd`; blank cells are not characters. Unit tests "does not count the cursor cell or blank cells after the input" and "sends nothing for a selection of only blank cells". See N1 for the new over-wide `inputEnd`.
F6 | Fixed | `deleteWordBackward` sends ESC DEL, line deletes send Ctrl+U; e2e "word and line deletion keys and repeated Backspace reach the shell".
F7 | Fixed | Rows wrapper `aria-hidden`, host is a named multi-line textbox; e2e asserts both. Screen-reader behaviour unverified.
F8 | Fixed | `restoreMirror` skips `isComposing`; layer freezes sync during composition; e2e "an active composition keeps its row until it ends, then sends once".
F9 | Fixed | Covered by F1 and the "IME and soft-keyboard keydowns are left to the browser" test.
F10 | Fixed | Comments updated; tap-to-focus runs only outside the host.
F11 | Fixed | Spec renamed to `touch-editing.spec.ts`; tests named above added, plus inactive-tab input and paste.
D1 | Fixed with gap | Paste releases the selection and replaces input selections. N1(b) breaks the "output selection sends only the paste" promise when the output lies after `inputStart`.
D2 | Not effective | Wrapped single-line commands work. Hard-break multi-line commands from paste never reach the edit (N2).

## 5. Callers and sibling paths checked

- `noteSentInput`: one caller, `App.sendInput` (App.tsx:322). Every session
  write goes through `sendInput` (App.tsx:318 is the only `handle.write`):
  typing via `onInput` (:1129), key bar (:382), gestures (`targets.onInput`),
  paste, and selection edits. Called after the write and before echo, so the
  recorded cursor is the input position.
- `startsCommandInput` (Terminal.tsx:725): xterm replies (DA, CPR, focus and
  SGR mouse reports) start with ESC and do not match; they do refresh
  `lastSentAt`, which only widens the 1 s window.
- `pasteText` callers: native paste (`pasteInto`, capture phase on the host,
  `activeRef` checked) and ClipboardMenu `onPaste` (App.tsx:851, active tab
  only). `beforeinput` `insertFromPaste` is not mapped, so no double send.
- `deleteByCut` with an input selection replays the deletion; the clipboard
  write is the `cut` event's own default.
- Desktop: `touchHost` false leaves `textLayer` and `mirror` null; focus, blur,
  paste, and keys use xterm as at HEAD. `noteSentInput` and `onWriteParsed` run
  but only update two locals. The desktop e2e passes.
- Key bar buttons call `preventDefault` on pointerdown and mousedown
  (KeyBar.tsx:49, 112-168), so the new blur handler does not drop `inputmode`
  on key presses.
- `cursorSequence` export: only caller `selectionEditBytes`.
- Sibling of N1: `placeCaretAtCursor` (terminalTouch.ts:203) indexes
  `rows.children[cursorY]`, a base-relative row, against viewport rows; with the
  viewport scrolled up the caret lands on the wrong row (cosmetic, no bytes).

## 6. Check results

Run in `frontend/` with Node v26.13.0:

- `npm test`: `Test Files  39 passed (39)` / `Tests  543 passed (543)`
- `npx tsc -b`: `TypeScript: No errors found`, exit 0
- `npx oxlint`: exit 0, no output
- `npm run format:check`: `All matched files use the correct format.`
- `npx playwright test`: `PASS (90) FAIL (0)`, 89.4 s

Proof tests (scratchpad `proof.test.ts`, the repo's `fakeTerm` helper, run
with a scratchpad vitest config; not added to the repo): 3 failed as expected,
each asserting `selectionEditBytes` returns null:

```
BYTES "\u001b[C\u001b[C\u001b[C\u001b[C\u001b[C<DEL><DEL><DEL><DEL><DEL>"   (N1a RPROMPT)
BYTES "\u001b[D" x13 + "<DEL><DEL><DEL>"                                     (N1b Tab listing)
BYTES "\u001b[D\u001b[D\u001b[D\u001b[D\u001b[D<DEL>"                        (N3 vim rows)
```

After the e2e run the relay it started (PID 3839322, cwd
`relay/`) was killed. `run-all-in-one.js`
(PID 3836529) was running before the run and was left alone.

## 7. Not reviewed or not verified

- No physical iPhone, iPad, or Android device. Native callouts, caret and handle
  drags over the host (possible stray swipes), `inputmode` change on an
  already-focused host, QuickType or autocorrect `insertReplacementText` with a
  collapsed selection (the handler ignores `getTargetRanges`, so a predictive
  replacement could duplicate a partial word; SUSPECTED, not traced on device),
  IME, VoiceOver, and TalkBack are unverified.
- Shell and editor reactions in N1-N3 come from documented readline, ZLE, and
  vim defaults, not from running those programs; the e2e sshd only echoes.
- xterm `isWrapped` handling after readline redraws (EL/ED resetting the flag)
  was not traced; a cleared flag on a wrapped row would add one phantom newline
  and one extra DEL.
- README, USER-GUIDE, and Help were checked only for the touch editing claims.
- No web lookup was made. Input Events and iOS selection behaviour come from
  prior knowledge.

Route N1-N7 to the change author or debugengineer.
