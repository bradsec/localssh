# Editable touch surface device spike

## Scope and switch

This spike is available on coarse-pointer devices at `?editable=1`. Remove the query parameter to compare the released touch path in the same container. No setting or server change is involved. The URL flag applies to iPhone Safari on iOS 26 or later and current Android Chrome; physical-device compatibility is not yet proven.

Files changed for this spike: `frontend/src/components/Terminal.tsx`, `frontend/src/terminalTouch.ts`, `frontend/src/app.css`, `frontend/e2e/editable-spike.spec.ts`, and this report. The pre-existing uncommitted edits in `frontend/src/app.css` and `frontend/e2e/touch-selection.spec.ts` were preserved. No branch or commit was created, per lead override.

Follow-up files: `frontend/src/terminalKeys.ts`, `frontend/src/terminalKeys.test.ts`, `frontend/src/terminalTouch.test.ts`, `frontend/e2e/key-bar.spec.ts`, `frontend/src/components/ConnectDialog.tsx`, `frontend/src/components/ConnectDialog.test.tsx`, `frontend/src/components/SavedHostEditor.tsx`, `frontend/src/components/SavedHosts.tsx`, `frontend/src/components/ClipboardMenu.tsx`, and `frontend/src/components/FilePanel.tsx`. `App.tsx` contains no input fields; its existing autocomplete flows remain unchanged.

The flagged mirror is one full-size `contenteditable="plaintext-only"` host. The key bar's Show and Hide actions switch its `inputmode` between `text` and `none` and focus or blur it. xterm's helper textarea stays in the DOM but is not the touch focus target. The mirror has an accessible name; xterm's screen reader mode and accessibility tree remain enabled. Output updates the mirror while a collapsed caret is focused; if its row changes, the caret moves to the xterm cursor row and clamped column. A non-collapsed selection remains frozen until dismissed. The input bridge cancels `beforeinput`, maps text, replacement text, Enter, and Backspace through `term.input`, sends composition text on `compositionend`, and routes plain-text paste through `term.paste`. A slipped DOM mutation is restored from xterm rows on `input` or `compositionend`.

Edits to a selection entirely on the visible cursor row now move to its end with terminal cursor-key bytes and send one DEL per selected cell. Replacement text follows those bytes once. Selection in output or across rows sends no edit bytes. xterm buffer cell widths cover wide characters. The test SSH server only echoes bytes, so Playwright checks the ordered session input; visual deletion remains an iPad device check. The key bar shows `bksp` while retaining the accessible name “Backspace” and a 44 px minimum target. Host, port, username, secret, path, and file-filter fields request no auto-capitalisation, autocorrect, or spelling correction. Saved-host nicknames remain free text.

`attachGestures` ignores pointers that start on the editable host. It does not call `preventDefault`, capture a pointer, focus xterm, or start its 600 ms fallback there. The host's separate pointer listener scrolls xterm scrollback on vertical drag without canceling the browser event. Swipe keys remain on gestures that start outside the host. The retained Select text action remains the fallback. Hardware keyboards on the host are outside this spike.

## Device test script

Record device model, OS and browser version, URL, initial focus, keyboard visibility, every tap count, keyboard motion, and exact text pasted into the other app. Use a session with visible `alpha beta gamma` output and a shell/editor that can show received paste once. Run the script twice on each device: first with `?editable=1`, then without the flag for comparison.

1. On iPhone with iOS 26 Safari, start with the keyboard hidden. Double-tap `beta`, drag selection handles through `gamma`, choose Copy, paste into Notes, and compare the exact text. Repeat with the keyboard shown. Record whether selection changes keyboard visibility or focus.
2. In each keyboard state, tap the prompt caret once, choose native Paste, and verify one shell insertion. Record any extra tap or keyboard movement. Repeat with bracketed paste enabled in a capable shell/editor. The target requires one tap and no keyboard motion.
3. Type text, Backspace, and Enter. Test one composition or dictation input if available. Scroll output vertically and try a swipe key outside the editing host. Check for duplicate bytes, a changed mirror, focus loss, and stale selections.
   Select several characters on the prompt row, press Backspace, and verify the full selection disappears. Repeat with replacement text, Forward Delete, and Cut. Select output on another row and confirm Backspace sends no shell edit.
4. On Android Chrome, repeat both keyboard states and the same typing, paste, scroll, and Copy checks. Android may expose selection through long press or double-tap with handles and a floating action bar, and may show Paste after a caret tap. Record which native gesture works; do not require Safari's exact callout layout. Verify that the spike does not block either native selection gesture.

Linux Playwright WebKit and Chromium can test DOM attributes, event routing, and focus ownership. They cannot prove iOS 26 Safari or Android Chrome callouts, selection handles, keyboard motion, VoiceOver, TalkBack, or exact copied text on physical devices. A hidden-state tap that raises the iPhone keyboard, loses handles, or needs more than one tap for Paste fails the device gate from the approved design.

## Checks

All commands ran from `frontend/` with Node 26.13.0.

| Check | Result |
| --- | --- |
| `npm test` | `Test Files  40 passed (40)`; `Tests  544 passed (544)` |
| `npx playwright test --browser=chromium` | `82 passed (1.5m)` |
| `npx playwright test e2e/touch-selection.spec.ts e2e/editable-spike.spec.ts --browser=webkit` | `31 passed (25.5s)` |
| `npm run lint` | Exit 0 |
| `npm run format:check` | `All matched files use the correct format.` |

The real Playwright connection used the local SSH test server. Dispatched `beforeinput` sent `ls` to that session once, a dispatched paste sent `plain-paste` once, and output arrived while a DOM range remained selected. A focused, collapsed caret stayed inside the mirror after new shell output appeared in both Chromium and WebKit. Playwright wrapped the session's `write` method to capture plaintext input bytes; it checked three cursor-left sequences followed by three DEL bytes for `abc` selected before `XYZ`, and no input for output-row edits. The existing unit test for `term.paste` verifies `\x1b[200~` and `\x1b[201~` framing after bracketed mode is enabled. No physical-device test ran.

## Notes for the lead

- **LOW confidence:** Physical iPhone and Android gesture behavior is unverified. Do not roll out the flag as the default until both device scripts pass.
- **LOW confidence:** VoiceOver and TalkBack may announce mirrored output as well as xterm's accessibility tree. Confirm on devices before deciding whether to hide the mirrored row subtree.
- **MED confidence:** Hardware keyboard shortcuts and arrow keys on the editable host are not bridged in this spike.
- **MED confidence:** The buffer API supplies cell widths, including CJK characters, but browser selection of emoji clusters and actual shell line editing still need iPad and Android checks. The byte echo server cannot prove visible deletion.
- xterm API authority: installed `frontend/node_modules/@xterm/xterm/src/browser/public/Terminal.ts` and `src/browser/CoreBrowserTerminal.ts`, xterm 6, accessed 2026-11-03. `input` feeds the existing data path; `paste` retains xterm's bracketed-paste handling.
