# 29 Fixes for the editable touch surface (D1, D2, F1-F11)

Step 29 fixes the device reports D1 and D2 and the review findings F1-F11 from
[28-changereviewer.md](28-changereviewer.md). Branch `fix/ios-copy-paste`; all
changes are uncommitted. Date: 2026-11-03.

## Coverage

ID | Status | Change | Test
---|---|---|---
D1 | Fixed | Every paste (native Paste callout and the Clipboard menu's paste) first deletes a selection that lies inside the current command input, then pastes once, then collapses the selection to a caret at the xterm cursor and resyncs the mirror (`releaseSelection`). A selection over output is not deleted, only dropped. | `e2e/touch-editing.spec.ts`: "paste over an output selection sends only the paste and drops the highlight", "paste over selected command input replaces it once"
D2 | Fixed | Terminal tracks the buffer cell where the first input byte of the current command line went (`inputStart`). Selection edits work for any selection that starts at or after it and ends at or before the input's end, across rows. See the heuristic below. | `src/terminalTouch.test.ts` (hard break, wrapped row, out-of-input cases); e2e "Backspace deletes a selection across the rows of a multi-line command", "a selection reaching from output into the input sends nothing"
F1 | Fixed | The host's keydown bridge no longer intercepts `keyCode` 229, `Dead`, `Unidentified`, `Process`, or Alt+printable on a Mac platform. Off Mac platforms Alt+printable is still forwarded so xterm sends its ESC prefix, as at HEAD. | e2e "Option characters reach the shell once through text input" (platform stubbed to `MacIntel` before xterm loads), "IME and soft-keyboard keydowns are left to the browser", "Alt with a letter keeps xterm's Escape prefix off Mac platforms"
F2 | Fixed | Selection edits count line-editor characters: a cell counts when its width is above 0 and it holds a character, so a wide character counts once. The unit test that pinned 2 cells per wide character now asserts one DEL and character-counted arrows. | `src/terminalTouch.test.ts` "counts a wide character once, not per cell"
F3 | Fixed | `attachGestures` watches touches on the editable host without `preventDefault` or pointer capture. Swipes, history flicks, one-finger scroll, and two-finger scrollback run there again. A native selection at pointerdown or during the move, or a `pointercancel`, ends the gesture. The separate single-pointer mirror scroll handler (which mixed two fingers) is gone. Phones keep one-finger vertical scroll and no swipe keys. | `e2e/touch-selection.spec.ts` "tablet › swipe keys work over the editing host and stand down for a native selection" (restored from HEAD, adapted: asserts no cancel and no capture on every event, Tab sent, pointercancel sends nothing, selection stand-down)
F4 | Fixed | The host reports native `focus` and `blur` through `onFocusChange`. Blur sets `inputmode="none"`. A focus with `inputmode="none"` reports unfocused, because no keyboard is up. | e2e "native blur and focus keep the key bar keyboard toggle in step"
F5 | Fixed | The range end is clamped to the input's end (the later of the cursor and the last character), and blank cells are not characters, so the cursor cell is never deleted. | `src/terminalTouch.test.ts` "does not count the cursor cell or blank cells after the input", "sends nothing for a selection of only blank cells after the input"
F6 | Fixed | `deleteWordBackward` sends ESC DEL; `deleteSoftLineBackward` and `deleteHardLineBackward` send Ctrl+U. Each `deleteContentBackward` sends one DEL. With a selection, any `delete*` input type replays the selection edit. | e2e "word and line deletion keys and repeated Backspace reach the shell"
F7 | Fixed | The cloned rows sit in a `.terminal-touch-rows` wrapper with `aria-hidden="true"`. The host keeps `role="textbox"`, `aria-multiline="true"`, and its accessible name. Stale comment replaced. | e2e "editable host owns touch focus and follows keyboard intent" (wrapper hidden, one named textbox)
F8 | Fixed | The `input` restore skips `isComposing` events. The layer freezes mirror syncs between `compositionstart` and `compositionend`, as it does for a selection. | e2e "an active composition keeps its row until it ends, then sends once"
F9 | Fixed by F1 | 229 and `Unidentified` keydowns are no longer cancelled. | Same as F1
F10 | Fixed | Stale comments updated (Terminal setup, gestures doc comment, layer doc comment, CSS row comment). The tap-to-focus branch now runs only for touches outside the host; on touch it keeps the current `inputmode`, and the host's focus listener reports it. | e2e "a touch outside the mirror does not focus xterm's textarea" (existing)
F11 | Fixed | `e2e/editable-spike.spec.ts` renamed to `e2e/touch-editing.spec.ts`; tests added for Option characters, word delete, composition, inactive tab, and external blur. | e2e "an inactive tab's editing host sends no input or paste" plus the tests above

Clipboard menu note (for codereviewengineer): not changed. Routing "Copy
selection" to the mirror's selection is more than a few lines: the menu's
`hasSelection` comes from xterm's `onSelectionChange`, so the button stays
disabled on touch, and Terminal would also need a `selectionchange` report.
Opening Actions and Clipboard on a phone may also drop the native selection
on iOS (unverified). The Help clipboard topic still says "Clipboard can copy a
live terminal selection", which holds on desktop only.

## D2 heuristic and limits

`noteSentInput` in `Terminal.tsx` sees every byte App writes to the session
(typing, key bar, paste, selection edits). The first byte of a command line
that is printable text, a bracketed paste start, or a cursor key records the
xterm cursor cell as `inputStart`. Enter (`\r`), Ctrl+C, and Ctrl+D clear it.
Output that arrives more than 1 s after the last sent byte, or a switch to the
alternate buffer, also clears it. xterm's own replies (device attributes,
cursor and focus reports) do not set it.

`selectionEditBytes` (`terminalTouch.ts`) treats the cells from `inputStart`
to the later of the cursor and the last character as the line editor's
buffer. An autowrapped row adds no character; any other row break counts as
one newline, which is how readline holds a multi-line command. Limits: the
screen is not the shell's real buffer. Right prompts, editors that redraw
elsewhere, full-screen programs, and a slow link where echo takes more than
1 s break the assumptions. Errors there fall back to sending nothing, or to
extra arrows and DELs that readline clamps at the line start. Selections
starting before `inputStart` send nothing.

## Files

- `frontend/src/components/Terminal.tsx`: input-start tracking and
  `noteSentInput`, paste replace and release, `beforeinput` mappings, keydown
  filter, host focus and blur, gesture handling over the host.
- `frontend/src/terminalTouch.ts`: character-counted `selectionEditBytes`,
  `selectedBufferRange`, rows wrapper, composition freeze, `releaseSelection`.
- `frontend/src/App.tsx`: `sendInput` calls `noteSentInput` after a write.
- `frontend/src/app.css`: row width rule targets `.terminal-touch-rows > div`.
- `frontend/src/helpTopics.ts`, `README.md`, `docs/USER-GUIDE.md`: tablet
  gestures, multi-line selection edits, paste replacing and clearing the
  highlight.
- Tests: `frontend/src/terminalTouch.test.ts`, `frontend/src/App.test.tsx`
  (mock control), `frontend/src/helpTopics.test.ts`,
  `frontend/e2e/touch-editing.spec.ts` (renamed and extended),
  `frontend/e2e/touch-selection.spec.ts` (rows wrapper, tablet test).

## Checks

Run in `frontend/` with Node v26.13.0:

- `npm test`: `Test Files  39 passed (39)`, `Tests  543 passed (543)`
- `npx tsc -b`: no errors
- `npx oxlint`: exit 0, no warnings
- `npm run format:check`: `All matched files use the correct format.`
- `npx playwright test` (Chromium): 90 passed
- `npx playwright test e2e/touch-editing.spec.ts e2e/touch-selection.spec.ts --browser=webkit`: 39 passed
- `npx playwright test e2e/key-bar.spec.ts --browser=webkit`: 13 passed
- `E2E_COMBINED=1 npx playwright test`: 90 passed

The e2e SSH server echoes bytes, so tests assert the bytes sent, not
line-editor results. Linux Chromium and WebKit do not prove iOS callouts,
handles, keyboard motion, IME, or VoiceOver.

## Device re-test script

Record device, OS and browser version, keyboard state at start, and every
extra tap, keyboard movement, or duplicate shell input. Use bash at a prompt.
Run each step with the on-screen keyboard shown, then hidden.

1. D1 (iPad, iPhone, Android): run `echo alpha beta`. Copy `PASTE` from Notes.
   Select `beta` in the output and choose Paste. Expect `PASTE` once at the
   prompt, no highlight left, and new output (press Enter) drawn without a
   stale highlight. Type `echo one two`, select `two`, choose Paste. Expect
   `echo one PASTE`.
2. D2: paste a two-line command from Notes, for example `echo a` newline
   `echo bb`, so bash shows it on two lines without running it (bracketed
   paste). Select from `a` through `echo b` across both lines and press
   Backspace. Expect `echo b` on one line. Select part of the output above the
   prompt plus part of the command and press Backspace: nothing changes.
   Select text containing a wide character (`echo 日本 x`, select `本`): only
   `本` is deleted.
3. F1 (iPad with hardware keyboard): on a German layout press Option+L (`@`),
   Option+5 (`[`); on a US layout press Option+B (`∫`) and a dead key such as
   Option+E then E (`é`). Each character appears once. Ctrl+C, arrows, Tab,
   and Esc still work. On Android, type with Gboard and a Japanese IME and
   check no dropped or doubled text.
4. F3 (iPad): with no selection, swipe right across the terminal text (Tab),
   left (Esc), flick up and down at the bottom (history), and drag with two
   fingers through scrollback. Then select a word and swipe: nothing is sent,
   and the handles still drag. Drag the caret or a handle horizontally: no Tab
   or Esc is sent. On iPhone, a one-finger vertical drag scrolls and no swipe
   sends a key.
5. F4: show the keyboard, then tap the Files filter, open Actions, or press the
   iOS hide-keyboard key. The key bar shows Show keyboard. One press of it
   raises the keyboard. Tap the terminal with the keyboard hidden: it stays
   hidden.

## Open risks

- LOW confidence: iOS may treat a caret or handle drag as an ordinary touch
  without `pointercancel` or a non-collapsed selection, so a horizontal caret
  drag on iPad could send Tab or Esc. Step 4 checks it.
- MED: the D2 heuristic depends on the screen layout matching readline's
  buffer. The 1 s unprompted-output window can drop the input start on a slow
  link; selection edits then send nothing until the next command line.
- MED: VoiceOver and TalkBack behaviour with the hidden rows wrapper and the
  named textbox is unverified; a screen-reader user may not reach native
  selection on the copy.
- `placeCaretAtCursor` still uses `cursorX` as a text offset, so after a wide
  character the restored caret sits one character late (SUSPECTED, not
  changed).
- Doc 27 still names `e2e/editable-spike.spec.ts`; it is a historical record
  and was not edited.
