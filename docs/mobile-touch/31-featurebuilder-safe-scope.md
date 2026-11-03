# 31 Safe-scope fixes for touch selection edits (N1-N7)

Step 31 answers [30-changereviewer.md](30-changereviewer.md) under the user's
SAFE SCOPE decision: a selection delete or replace acts only where the
command line is certain, and sends nothing anywhere else. A wrong delete is
never acceptable; a missed edit is. Branch `fix/ios-copy-paste`, uncommitted.
Date: 2026-11-03.

## Rule

`selectionEditBytes` (`frontend/src/terminalTouch.ts`) returns bytes only when
all of these hold, and null (nothing sent) otherwise:

1. The active buffer is the normal buffer, not the alternate screen.
2. An input start exists: the cell where this command line's first typed byte
   went. Enter, Ctrl+C, Ctrl+D, a buffer switch, output more than 1 s after the
   last sent byte, and trimming of that line from scrollback clear it.
3. The cursor is at or after the input start, and every row after the input
   start's row up to the cursor's row is an autowrap continuation
   (`isWrapped`). Any other row break (a multi-line command, a Tab Tab
   listing, a redrawn prompt) is uncertain.
4. The input ends at the first cell after the cursor, on the cursor's logical
   line, that holds no character. A right prompt behind a never-written gap is
   outside the input.
5. The range starts at or after the input start and before the input end. Its
   end is clamped to the input end.

Bytes are cursor keys from the cursor to the range end, then one DEL per
character in the range. A wide character counts once.

## Coverage

ID | Status | Change | Test
---|---|---|---
N1 | Fixed | Rules 3 and 4 above replace the scan to the buffer end. | Unit: "never treats a right prompt as input", "never treats a completion listing printed after Tab as input", "sends nothing when a hard row break lies between the input start and the cursor", "follows a long command onto its wrapped rows after the cursor". E2E: "a right prompt is never deleted as input" (clock drawn with save cursor, column move, restore), "paste over a completion listing name pastes at the cursor without deleting", "Backspace deletes a selection in a long command that wraps".
N2 | Scoped out | Multi-line commands are out of scope. No bracketed-paste tracking was added; `\r` still clears the input start. README.md, docs/USER-GUIDE.md, and Help now say selection edits work in the command being typed, including a long command that wraps, and that a multi-line command is edited with Backspace or Ctrl+U. | E2E "a selection across a hard row break of a multi-line command sends nothing" (replaces the test that asserted a multi-row delete); `helpTopics.test.ts` checks the new wording.
N3 | Fixed | Rule 1, and `noteSentInput` does not record an input start in the alternate buffer. | Unit "sends nothing in the alternate screen"; E2E "selection edits in the alternate screen send nothing".
N4 | Fixed | With a non-collapsed selection, `delete*` input types send the edit or nothing. `insertText`, `insertReplacementText`, `insertParagraph`, and `insertLineBreak` delete the selection first only when it is inside the input; otherwise they drop the selection and send the text or Enter at the xterm cursor. | E2E "Backspace on output selection sends nothing; typing goes to the cursor", "Enter over an output selection drops it and runs the command", "a selection reaching from output into the input deletes nothing".
N5 | Fixed | Terminal sends edit bytes through `term.input` with a `raw` flag on `onInput`; App's `sendInput(data, raw)` skips `applyModifiers` for raw bytes and leaves the modifiers armed for the next key. The inserted text still takes the armed modifier. | `App.test.tsx` "sends terminal-generated edit bytes past an armed modifier".
N6 | Fixed | The layer keeps an xterm marker on the buffer line shown by the first mirrored row, re-registered on each sync. While the copy is frozen the marker follows scrollback trimming; `rowsTop()` returns null once the line is gone or after a buffer switch, and the edit then sends nothing. The input start is also a marker. `bufferRange` maps with that top line, not the live viewport. | Unit "maps a range in the mirrored rows to buffer cells from the rows' top line" (frozen top differs from live viewport).
N7 | Fixed | Removed `touch-action: pan-y` from the editing host; it inherits `none` from `.terminal-host`. | Existing gesture e2e tests.
QuickType | Fixed (code path confirmed, not device-confirmed) | A collapsed `insertReplacementText` used to send its data without deleting the text it replaces. It now reads `getTargetRanges()`: it deletes the target first when the target is inside the input, and sends nothing when there is no target or the target is elsewhere. | E2E "a predictive replacement deletes the partial word it replaces" (Chromium honours synthetic target ranges and asserts DEL x3 + `hello`; WebKit drops them and the test asserts nothing is sent); "editing keys map to terminal bytes" now asserts a target-less replacement sends nothing.

## Files

- `frontend/src/terminalTouch.ts`: safe-scope `selectionEditBytes`,
  `typedEnd`, `bufferRange` (renamed from `selectedBufferRange`, takes a top
  line and any DOM range), top-line marker and `rowsTop()`.
- `frontend/src/components/Terminal.tsx`: input start as a marker, no input
  start in the alternate buffer, raw edit bytes, N4 branches, replacement
  target ranges, `onInput(data, raw)`.
- `frontend/src/App.tsx`: `sendInput(data, raw)`.
- `frontend/src/app.css`: N7.
- `README.md`, `docs/USER-GUIDE.md`, `frontend/src/helpTopics.ts`: N2 and N4
  wording.
- Tests: `frontend/src/terminalTouch.test.ts`, `frontend/src/App.test.tsx`,
  `frontend/src/helpTopics.test.ts`, `frontend/e2e/touch-editing.spec.ts`.

## Checks

Run in `frontend/` with Node v26.13.0:

- `npm test`: `Test Files  39 passed (39)`, `Tests  548 passed (548)`
- `npx tsc -b`: no errors
- `npx oxlint`: exit 0
- `npm run format:check`: `All matched files use the correct format.`
- `npx playwright test` (Chromium): 96 passed
- `npx playwright test e2e/touch-editing.spec.ts e2e/touch-selection.spec.ts e2e/key-bar.spec.ts --browser=webkit`: 58 passed
- `E2E_COMBINED=1 npx playwright test`: 96 passed. A first combined run
  failed once in `key-bar.spec.ts` "swipes stay silent in phone landscape and
  after rotation to portrait" (21 WebSocket frames, expected 20). That test
  counts every frame, and the swipe it dispatches targets `.xterm-screen`
  outside the editing host, a path this step did not change. It passed 8 of 8
  with `--repeat-each=8` in combined mode, and the full combined rerun passed.
  It is recorded as a flake, SUSPECTED to come from a resize or keepalive
  frame.

The e2e SSH server echoes bytes. Right prompts, completion listings, and the
alternate screen are drawn with escape sequences the test sends; zsh, bash,
and vim were not run.

## Open risks

- MED: a right prompt or autosuggestion drawn with written spaces (not a
  never-written gap) right after the typed text would count as input. zsh's
  RPROMPT layout was not checked against a real zsh.
- MED: xterm may clear `isWrapped` when a line editor redraws a wrapped line
  with erase sequences. That makes a long command look multi-line, which now
  sends nothing (safe), not a wrong delete.
- LOW: on iOS, predictive text may arrive as `insertText` of the whole word
  with no replacement event; that would still double a partial word. Device
  check needed.
- Selection edits after Tab completion within the same command line send
  nothing until the next command when the listing pushed the prompt down.
- Device behaviour (callouts, handles, keyboard, IME, VoiceOver) remains
  unverified, as in docs 29 and 30.
