# 28 Change review: editable touch surface (fix/ios-copy-paste)

Reviewer: changereviewer. Date: 2026-11-03. Scope: `git diff HEAD` on
`fix/ios-copy-paste` (HEAD 2acb400, release 2026.11.02) plus untracked
`frontend/e2e/editable-spike.spec.ts`. 22 tracked files, +545 / -750, plus a
384-line spec. Docs 24-27 read as intent only. No files other than this one
were written.

## 1. Change and intent

Change (stated, from the brief and docs 25-27): on coarse-pointer devices the
mirrored xterm rows become one `contenteditable="plaintext-only"` editing host
so native iOS 26 Safari and Android Chrome selection, Copy, and Paste work with
the keyboard shown or hidden, while typed text, IME, Enter, Backspace, paste,
and iPad hardware keys reach the shell exactly once; the split touch path,
600 ms long-press fallback, and Select text view are removed; identifier
fields stop auto-capitalising; docs and Help follow.

## 2. Verdict

**CHANGES REQUIRED**, confidence MED. Decided by F1, F2, F3 (HIGH) and F4
(MEDIUM, HIGH confidence). Desktop is unchanged, double sends through xterm's
own textarea are prevented, paste is text/plain only through `term.paste`,
listeners are cleaned up, and inactive or closed tabs send nothing. The
blocking problems are in hardware-key forwarding on iPad, per-cell selection
edits, the silent removal of tablet gestures, and stale focus state.

## 3. Findings

ID | SEVERITY | file:line | problem | trigger | proposed fix | CONFIDENCE
---|---|---|---|---|---|---
F1 | HIGH | frontend/src/components/Terminal.tsx:239-263 | `onHardwareKey` cancels every Alt+printable and `Dead` keydown and re-dispatches a synthetic keydown to xterm's textarea. On iPad `navigator.platform` is `MacIntel`, so xterm's `isMac` is true (xterm 6.0.0 `src/common/Platform.ts:38`); with `macOptionIsMeta` unset, `_isThirdLevelShift` (`src/browser/CoreBrowserTerminal.ts:1057,1105-1116`) returns early and waits for a keypress that never comes because the original event was cancelled. No byte is sent and no `beforeinput` follows. | iPad hardware keyboard: German layout Option+L (`@`), Option+5/6 (`[`/`]`), dead `^` or `´`; US layout Option+B. At HEAD the same keys reached the shell through xterm's textarea (`@`, `∫`). The brief's "Alt combos reach the shell once" does not hold on iPad. | Do not intercept `altKey && key.length === 1 && !ctrlKey && !metaKey`, `key === "Dead"`, `"Unidentified"`, `"Process"`, or `keyCode === 229`; let `beforeinput`/`compositionend` deliver the text. Add an e2e test with `navigator.platform` stubbed to `MacIntel` before xterm loads. | MED (xterm source path traced; no iPad run)
F2 | HIGH | frontend/src/terminalTouch.ts:11-13, called at Terminal.tsx:211-217 | `selectionEditBytes` emits one cursor key per cell of distance and one DEL per selected cell. Shell line editors move and delete per character, and a wide character occupies two cells. The repo's own test (`terminalTouch.test.ts`, "counts a wide character as two terminal cells") pins `{start:0,end:2}` for one CJK character, which becomes `\x7f\x7f`. | Prompt line `echo 日本 x`, cursor at end, select `本`, press Backspace: cells 7-9, cursor 11, bytes `\x1b[D\x1b[D\x7f\x7f`; readline deletes `本` and the unselected `日`. Arrow counts overshoot the same way when wide characters lie between selection end and cursor. | Count characters (cells with `getWidth() > 0`) between `end` and `cursorX` for arrows and inside `[start,end)` for DELs; add a unit test with a wide cell inside and after the selection. | MED (byte output traced; readline behaviour from its documented per-character `backward-delete-char`, not run on a device)
F3 | HIGH | frontend/src/components/Terminal.tsx:478-483 with frontend/src/app.css:597-598 | The mirror now spans 100% of `.xterm-screen`, and `attachGestures` returns on any pointerdown inside it. Tablet swipe keys (Tab, Esc, arrows), vertical history flicks, and two-finger scrollback no longer run anywhere over the terminal text. The replacement single-finger handler (Terminal.tsx:265-285) keeps one `scrollY` for all pointers, so a two-finger drag mixes deltas from both fingers. Design doc 25 (lines 33, 58) says to keep swipe keys and scrollback. The e2e test `tablet › swipe keys stand down while a native selection exists`, whose control asserted that a right swipe sends Tab, was deleted. README dropped "and tablet" from "Desktop and tablet terminal gestures remain unchanged" without saying the gestures were removed. | iPad 820x1180: a right swipe across the terminal sends no Tab; a two-finger drag scrolls erratically. | Either keep tracking mirror touches in `attachGestures` for swipes past the threshold while skipping `preventDefault` and pointer capture (the HEAD `nativeTouch` approach), with selection stand-down; or remove tablet gestures on purpose and document that in README, USER-GUIDE, and Help. Restore the deleted control test either way. | HIGH (code path); MED (two-finger behaviour)
F4 | MEDIUM | frontend/src/components/Terminal.tsx:132-145, 155-156; App.tsx:389-397, 882, 1131 | On touch, focus state comes only from `controls.focus()`/`blur()`. The mirror has no focus or blur listener; the remaining listeners sit on xterm's textarea, which never takes focus on touch. A native blur leaves `terminalFocused` true and `inputmode="text"`. | Show keyboard, then tap the Files filter, the Actions menu, or the iOS keyboard-dismiss key: the key bar still shows "Hide keyboard" (`aria-pressed=true`), the first toggle press only resets state, and a second press is needed. A later tap on the terminal raises the keyboard because `inputmode` is still `text`. | Add `focus`/`blur` listeners on the mirror that call `onFocusChangeRef`, and set `inputmode="none"` on native blur. Add an e2e test that blurs the host natively and checks the toggle's `aria-pressed`. | HIGH
F5 | MEDIUM | frontend/src/terminalTouch.ts:11-13, 17-46 | The cursor row renders through `cursorX + 1` (xterm `DomRendererRowFactory.ts:79-81`), so a selection can include the cursor cell or blank cells after the input. Right arrows past end of line do nothing in readline, but the DEL count still includes those cells and deletes unselected characters. | Input `abc` with the cursor after it; drag a handle to select `c` plus the cursor cell: bytes are one right arrow (no-op) plus `\x7f\x7f`, which deletes `bc`. | Clamp `end` to `cursorX` when the cells from `cursorX` to `end` are blank; test it. | MED
F6 | MEDIUM | frontend/src/components/Terminal.tsx:196-229, 245 | Collapsed `beforeinput` maps only insertText, insertReplacementText, insertParagraph, insertLineBreak, and deleteContentBackward. Backspace keydown is never forwarded, whatever its modifiers, so `deleteWordBackward` and `deleteSoftLineBackward` are cancelled and send nothing. At HEAD, xterm sent `ESC DEL` for Alt+Backspace (`src/common/input/Keyboard.ts:84-89`). | iPad hardware Option+Backspace or Cmd+Backspace; holding Backspace on the iOS soft keyboard once it switches to word deletion. | Map `deleteWordBackward` to `\x1b\x7f` (or `\x17`) and `deleteSoftLineBackward` to `\x15`, or forward Backspace with modifiers to xterm. Add tests. | MED
F7 | MEDIUM | frontend/src/terminalTouch.ts:101-108 | The mirror lost `aria-hidden` and is now a focusable editable host (implicit textbox) holding a full copy of the visible output, while xterm's `screenReaderMode` tree (Terminal.tsx:112) still exposes the same output. The comment at :101 ("xterm's accessibility tree already announces the output") argued for `aria-hidden`, which this change removed. Docs 26 and 27 rate this unverified. | VoiceOver or TalkBack users navigating the terminal hear output twice; focusing the host reads the whole screen as a field value. | Decide on one exposed copy. For example, mark the row clones `aria-hidden` inside a host with `role="textbox"`, `aria-multiline`, and a short description, or turn off xterm's accessibility tree on touch. Verify on device. Fix the stale comment. | MED
F8 | MEDIUM (SUSPECTED) | frontend/src/components/Terminal.tsx:230-233, 287 | `restoreMirror` runs on every `input` event, including `isComposing` ones. `insertCompositionText` cannot be cancelled, so each composition step changes the row, and the restore replaces the row that holds the active composition. | Android Gboard, which composes every word, or a Japanese or Chinese IME on iOS. The composition may commit early, drop text, or include already-sent echoed characters when Gboard re-composes the word before the caret. | Skip the restore when `event.isComposing` and restore on `compositionend` (already wired). Add an e2e test that fires `input` with `isComposing: true` and checks that the row node is kept. Device-test Gboard. | LOW
F9 | LOW (SUSPECTED) | frontend/src/components/Terminal.tsx:239-263 | Android soft-keyboard keydowns arrive as `key: "Unidentified"`, `keyCode: 229`. They pass the filter and get `preventDefault`/`stopPropagation` and a forwarded copy. xterm's composition helper ignores 229, so nothing is sent twice, but where Chrome honours the cancel, IME input could be suppressed. | Android Chrome with Gboard. | Return early on `keyCode === 229` or `key === "Unidentified"`/`"Process"` (covered by the F1 fix). | LOW
F10 | LOW | frontend/src/components/Terminal.tsx:426-433, 617-620; frontend/src/terminalTouch.ts:85-92, 101; frontend/src/app.css:632 | Stale comments ("tap raises the keyboard", "invisible, selectable copy", "reaches the field"). The gesture tap-to-focus branch is close to dead because the mirror covers the screen, and when it runs it neither sets `inputmode` nor reports focus. | Code reading. | Update the comments; remove the branch or route it through `controls.focus()`. | HIGH
F11 | LOW | frontend/e2e/editable-spike.spec.ts | The default path is tested in a file named "spike". No tests cover: Alt/Option on a Mac platform, word deletion, `isComposing` input, `beforeinput` or paste on an inactive tab, or native blur state. | n/a | Rename the spec (for example `touch-editing.spec.ts`) and add the tests named in F1, F4, F6, and F8. | HIGH

## 4. Callers and sibling paths checked

- `TerminalControls.snapshotText` removed: no remaining callers (`grep` in
  `frontend/src`); App.tsx text-view state and its guards were removed as a
  unit. `sendInput` lost only the text-view guard; `transport === "resuming"`
  remains.
- `focus`/`blur` controls: callers at App.tsx:227-232 (pending focus), 238
  (tab switch), 389-410 (keyboard toggle, More keys panel), 536 and 749
  (close). All still hold except native focus changes (F4).
- Double send: xterm 6.0.0 binds keydown, keypress, input, and compositionstart
  on the textarea only (`CoreBrowserTerminal.ts:379-384`), and paste on the
  textarea and element (`:343-344`). The host's capture-phase `pasteInto`
  stops propagation, the textarea gets `tabIndex=-1` and `pointer-events:none`,
  and printable keydown is not forwarded. One path per byte confirmed for
  printable keys, Enter, Backspace, arrows, Ctrl combos, and paste.
- Inactive and closed: `onBeforeInput`, `onCompositionEnd`, and `pasteInto`
  check `activeRef`; forwarded keys reach `triggerDataEvent`, which drops input
  when `disableStdin` (`CoreService.ts:63,85`); closed tabs clear `handle`
  (App.tsx:522), which sets `active=false`.
- Dispose: all nine mirror listeners, host paste, `onRender`/`onScroll`, and
  `selectionchange` are removed; the mirror is removed in `textLayer.dispose`.
- `cursorSequence` was newly exported from terminalKeys.ts; its only new caller
  is `selectionEditBytes`.
- Desktop: `touchHost` false leaves `textLayer` and `mirror` null, so every
  new listener no-ops and focus/blur go to xterm; the e2e desktop test passes.
- XSS: the mirror clones xterm DOM rows (`cloneNode`), and xterm writes text
  through text nodes; paste reads `text/plain` only into `term.paste`
  (bracketed). No new HTML sink.
- Sibling: ClipboardMenu "Copy selection" reads xterm's selection, not the
  native mirror selection. This predates the change (HEAD already had the
  mirror). Route to codereviewengineer.
- Identifier fields (ConnectDialog, SavedHostEditor, SavedHosts, FilePanel,
  ClipboardMenu): attribute-only changes, consistent `autoCapitalize="none"`;
  the two hunks that add only two attributes already had `spellCheck={false}`.
- Deleted tests: Select text, snapshot, `selectWordAt`, and `pasteTerminalText`
  tests went with their removed code (justified). The tablet swipe test
  deletion is not justified (F3).

## 5. Check results

Run in `frontend/` with Node v26.13.0:

- `npm test`: `Test Files  39 passed (39)` / `Tests  535 passed (535)`
- `npx tsc -b`: exit 0, no output
- `npx oxlint`: exit 0, no output
- `npm run format:check`: `All matched files use the correct format.`
- `npx playwright test`: `78 passed (1.5m)`, including 18 editable-spike and
  9 touch-selection entries

After the run, the relay this run started (`run-local-relay.ts 8787`) was
killed. A `run-all-in-one.js` process (PID 3785207) was already running about
29 minutes before the run started, so it was left alone.

## 6. Not reviewed or not verified

- No physical iPhone, iPad, or Android device. Native callouts, handles,
  keyboard flicker, `inputmode` changes on an already-focused host, smart
  punctuation, dictation, IME, VoiceOver, and TalkBack are unverified. Doc 27
  says device checks are required before release, but this change makes the
  surface the default.
- F1 was traced through xterm source, not reproduced; Linux Playwright has
  `isMac` false.
- README, USER-GUIDE, and Help were checked against the code only for the
  claims touched here; the rest of the docs were skimmed.
- No web lookup was made. Input Events cancelability (`insertCompositionText`
  cannot be cancelled) and iPadOS `navigator.platform` (`MacIntel`) come from
  prior knowledge, not a checked source.

Route F1-F11 to the change author or debugengineer. Route the ClipboardMenu
selection gap to codereviewengineer.
