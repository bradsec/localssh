# Editable terminal surface on touch devices

## Scope and files

The live editable surface is now the default on coarse-pointer devices. There is no URL flag or setting. Mouse and desktop terminals retain xterm's helper textarea. The touch host mirrors visible output, owns focus, keeps native selection and paste gestures, and sends text and hardware key input through the existing terminal path.

Step 27 changed `frontend/src/components/Terminal.tsx`, `frontend/src/terminalTouch.ts`, `frontend/src/app.css`, `frontend/src/App.tsx`, `frontend/src/components/ClipboardMenu.tsx`, `frontend/src/helpTopics.ts`, `frontend/src/helpTopics.test.ts`, `frontend/src/App.test.tsx`, `frontend/src/terminalTouch.test.ts`, `frontend/e2e/editable-spike.spec.ts`, `frontend/e2e/touch-selection.spec.ts`, and `frontend/e2e/key-bar.spec.ts`. It removed `frontend/src/terminalSnapshot.ts` and its unit test. `README.md` and `docs/USER-GUIDE.md` now describe the shipped controls. The earlier step 26 form and key bar changes remain uncommitted. No branch or commit was made.

The prompt-row helper textarea overlay, 600 ms word-selection fallback, unused `selectWordAt`, Select text action, read-only view, and view-only tests are gone. The Clipboard menu remains. The editable host uses `contenteditable="plaintext-only"`, one full-size touch layer, and `inputmode="text"` or `none` for keyboard shown or hidden. The xterm helper textarea remains unfocused on touch. Native selection pauses mirror updates only while a non-collapsed selection exists. Changed rows sync with a collapsed caret focused; if its row is replaced, the caret returns to the xterm cursor row and clamped column.

The host forwards hardware keys that do not produce ordinary text to xterm's own `keydown` handler on its textarea. The original touch key event is canceled, so xterm's mapping supplies the same control and cursor bytes as desktop. Ordinary typing, Enter, and Backspace remain on the `beforeinput` bridge. Command+C and Command+V keep the browser's native copy and paste handling. The touch host still routes plain-text paste through `term.paste`, including xterm bracketed paste. The installed xterm 6 source at `frontend/node_modules/@xterm/xterm/src/browser/CoreBrowserTerminal.ts` was inspected on 2026-11-03: its textarea owns the `keydown` listener and its key handler uses `evaluateKeyboardEvent`.

## Coverage

| Requirement | Test |
| --- | --- |
| Default editable host, focus, keyboard mode, geometry, live output, caret and selection | `e2e/editable-spike.spec.ts`, `e2e/touch-selection.spec.ts` on Chromium and WebKit |
| `beforeinput`, composition, paste, command-line selection edits, output edit rejection | `e2e/editable-spike.spec.ts`, `src/terminalTouch.test.ts` |
| ArrowUp, Ctrl+C, ordinary typing once; Command copy and paste untouched | `e2e/editable-spike.spec.ts` on Chromium and WebKit |
| Key bar and 44 px touch controls; no Select text action | `e2e/key-bar.spec.ts`, `e2e/touch-selection.spec.ts`, `src/App.test.tsx` |
| Desktop xterm path | `e2e/touch-selection.spec.ts` desktop context, full E2E suite |
| Help, README, user guide | `src/helpTopics.test.ts`, documentation review |

## Device test script

Record model, OS and browser version, URL, initial focus, keyboard visibility, taps, keyboard motion, selection text pasted into another app, and any duplicate shell input. Use output containing `alpha beta gamma` and a prompt where text can be edited. Run each selection and paste check with the on-screen keyboard both shown and hidden.

1. On iPhone with iOS 26 Safari, double-tap `beta`, drag the handles through `gamma`, choose Copy, paste into Notes, and compare exact text. Repeat by long press. Confirm the keyboard state stays as it started.
2. On iPhone, tap the prompt caret and choose Paste. Confirm one insertion and no keyboard motion. Type, Backspace, Enter, and paste into a bracketed-paste-aware shell or editor. Select a command-line word and replace or delete it; select output and confirm Backspace sends no edit. Scroll to older output, select it, and copy it.
3. On iPad without a hardware keyboard, repeat the iPhone script in both keyboard states. Check that a selection and Paste keep the editable host focused and do not move the keyboard.
4. On iPad with a hardware keyboard, focus the terminal and press ArrowUp, Home, End, PageUp, PageDown, Esc, Tab, an F-key, and Ctrl+C. Check each shell effect once. Type `ab` and check it appears once. Use Command+C to copy selected terminal text into Notes and Command+V to paste it at the prompt. Repeat with the on-screen keyboard shown and hidden where the device permits.
5. On Android Chrome, repeat Copy, paste into Notes or another app, prompt Paste, typing, Backspace, Enter, command-line selection editing, output edit rejection, and vertical scroll with the keyboard shown and hidden. Android may select by long press or double-tap and show handles with a floating action bar; record the native gesture and menu used. Do not require Safari's callout shape.
6. On each device, confirm login, saved-host, path, filter, and secret fields do not auto-capitalise or autocorrect. Confirm the key bar shows `bksp` with a 44 px target. Check VoiceOver or TalkBack announcements against the xterm output and editable host.

Linux Playwright checks DOM and SSH byte routing. Physical device checks are still required for native handles, Copy/Paste menus, actual keyboard motion, accessibility announcements, and shell-visible deletion. The test SSH server echoes bytes, so it cannot prove line-editor deletion on the iPad.

## Checks

Pending final command results.

## Notes for the lead

- LOW confidence: iOS 26 Safari and Android Chrome gesture behavior needs the physical-device script before release. Linux WebKit does not prove native callouts or keyboard motion.
- MED confidence: Noncancelable IME and dictation edits, and the proposed prompt-side input island from the architecture design, remain unproven on devices. The current bridge restores slipped mirror mutations from xterm output and sends `compositionend` text once.
- MED confidence: VoiceOver and TalkBack announcement behavior needs device checks. The host has an accessible name, and xterm's accessibility tree remains enabled.
- The source tree and tests were kept uncommitted as requested.
