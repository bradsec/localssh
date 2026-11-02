# Step 20: native selection and paste on the live terminal

Building: native touch select and paste directly on the live terminal for phone and tablet users, done means long press on terminal text selects it with the browser's own selection UI, long press on empty space reaches a real editable field for the native Paste callout, the "Select text" pill is gone, and desktop behaviour is unchanged.

## Assumptions

- "Touch device" means `(pointer: coarse)`, the same test `App.tsx` uses for the key bar. Desktop gets no extra DOM.
- Long press on a glyph selects text; long press on empty space (right of a row's text, blank rows) is the Paste path. One element cannot be both, so the split is by what is under the finger.
- Selection is of the visible screen only. Scrollback stays on the read-only Select text view in the Actions menu.
- The Select text entry shows on touch devices only, as the old pill did.

## Approach

- Text layer: `attachTouchTextLayer` (src/terminalTouch.ts) appends an invisible `div.terminal-touch-text` inside `.xterm-screen`, aligned at 0,0 over xterm's `.xterm-rows`. It clones the live row divs (xterm's inline width, height, line-height, letter-spacing per span come along) and copies the live rows' computed font family, size, weight, letter spacing, and line height. It resyncs on `term.onRender` and `term.onScroll`. `syncVisibleRows` replaces only rows that differ, so an unchanged row keeps its element. While a selection exists inside the layer, syncing pauses (replacing a row would drop the selection) and resumes on `selectionchange` when it clears.
- The layer is `user-select: text`, `-webkit-touch-callout: default`, `pointer-events: auto`, text and backgrounds transparent, so only the native highlight shows over the live rows. `aria-hidden="true"` keeps screen readers on xterm's own accessibility tree (screenReaderMode stays on).
- Rows are `width: fit-content !important`, so empty space to the right of text is not part of the layer.
- Paste: on touch, `.xterm-helpers` and xterm's own helper textarea (the real editable xterm already focuses) are stretched over the whole screen (`!important` over xterm's inline cursor positioning), beneath the text layer, `isolation: isolate` on the host so panels such as Files stay above. A touch on empty space lands on that textarea: tap focuses it and opens the keyboard, long press or caret tap gives the native Paste callout. A capture-phase `paste` listener on the host calls `pasteTerminalText`, which sends `clipboardData` through `term.paste` (xterm's path, so bracketed paste is honoured) and stops the event so xterm's own listener does not send it a second time. No `navigator.clipboard` use, so it works over plain HTTP. ClipboardMenu Paste is untouched as the fallback.
- Gestures: `attachGestures` ignores pointerdown, move, and release while a selection exists in the layer (no swipe keys, no scroll, no tap-focus), and does not preventDefault in that case so the browser can dismiss its selection. The old 500 ms long press that opened the text view is removed. A 600 ms fallback selects the word under a stationary finger if the browser did not start a selection itself (needed because Playwright cannot do an iOS native long press, and a safety net on the phone).
- Pill removed (App.tsx, `.terminal-select-button` CSS). `Select text` is now a toolbar button (TextSelect icon) in the Actions menu / toolbar row for touch devices. `onSelectText` prop removed from `Terminal`.
- Help text, README, and USER-GUIDE updated for the new behaviour.

## Files changed

- frontend/src/terminalTouch.ts (new): `syncVisibleRows`, `pasteTerminalText`, `hasSelectionIn`, `selectWordAt`, `attachTouchTextLayer`.
- frontend/src/terminalTouch.test.ts (new, from the earlier partial run, extended).
- frontend/src/components/Terminal.tsx: attach layer, paste listener, gesture gating, long-press change, `onSelectText` removed.
- frontend/src/App.tsx: pill removed, Select text toolbar button added.
- frontend/src/app.css: touch layer and textarea overlay rules, pill rules removed.
- frontend/src/App.test.tsx: mock and tests adapted (Select text via Actions, no long-press test).
- frontend/src/helpTopics.ts, README.md, docs/USER-GUIDE.md: copy.
- frontend/e2e/touch-selection.spec.ts, frontend/e2e/key-bar.spec.ts: new and adapted specs.

## Tests

Unit (src/terminalTouch.test.ts): row mirror (mirrors, keeps unchanged row elements, shrinks on resize, grows); `hasSelectionIn`; `selectWordAt` off text; paste handling (sends text and prevents default, ignores empty clipboard, and a real xterm `Terminal` sends the raw text before bracketed mode and `ESC[200~two ESC[201~` after `ESC[?2004h`).

E2E (frontend/e2e/touch-selection.spec.ts, hasTouch + isMobile, WebKit and Chromium): no pill and Select text present in Actions; text layer has the same row count, font, row heights, row tops, and text position as the live rows and is `aria-hidden`; long press on a word creates a DOM selection inside the layer; long press on empty space selects nothing; tap on text and tap on empty space focus the terminal; paste event on the helper textarea reaches the session exactly once; at tablet width a right swipe sends Tab with no selection and sends nothing while a selection exists; desktop context has no layer and no Select text. The existing Select text view test now opens it from Actions.

Bracketed-paste is covered by the unit test only: the e2e SSH server just echoes input, so the echoed `ESC[200~` is swallowed by the terminal and cannot be told apart on screen.

## Check results

- `npx vitest run --exclude "e2e/**"`: Test Files 40 passed (40), Tests 539 passed (539)
- `npx tsc -b`: TypeScript: No errors found
- `node_modules/.bin/oxlint`: exit 0, no output. `npm run lint` prints only "ESLint output (JSON parse failed: EOF while parsing a value at line 1 column 0)" through the rtk wrapper; the direct call is the reliable verdict.
- `npm run format:check`: All matched files use the correct format.
- `npx playwright test` (full, default Chromium project): 56 passed (1.5m)
- `npx playwright test e2e/touch-selection.spec.ts --browser=webkit`: 10 passed (16.9s)

One real defect found and fixed during the run: the stretched textarea and text layer sat above the Files panel and swallowed the tap on Resume download (e2e "resumes an 8 MiB download by offset" timed out). `.terminal-host--touch { isolation: isolate }` confines the layers; the test then passed.

No `run-local-relay.ts` or testsshd process remains.

## What to test on the iPhone

1. Open the app over HTTP on the LAN, connect, run `ls -la` so the screen has text.
2. Touch and hold a word in the output. Expect a native highlight with handles, magnifier, and the Copy callout. Drag the handles, tap Copy.
3. While the selection is up, swipe or drag on the terminal (tablet: swipe right). Expect nothing sent to the shell and no tab or Esc.
4. Tap outside to dismiss. Expect the selection to clear; a second tap focuses the terminal and opens the keyboard.
5. Tap a word with no hold. Expect the keyboard to open and no selection.
6. Scroll with one finger vertically. Expect scrollback as before.
7. Copy something elsewhere, then touch and hold empty space to the right of the prompt. Expect the native Paste callout; tap Paste. Expect the text at the prompt (with bracketed paste in vim or a modern shell).
8. Tap the empty area once with the clipboard filled; on iOS a tap on the caret may also show Paste.
9. With output arriving while a selection is up: the text layer freezes, so the highlight stays on the old text until it is dismissed.
10. Actions, Select text still opens the read-only view; the floating pill is gone and no text is covered.
11. Check the highlight lines up with the visible text at several font sizes (Settings) and after the keyboard opens and closes.

Only a physical iPhone can confirm: whether Safari starts its own selection from a long press on the layer (the 600 ms JS word-select is a fallback and may show different handle and callout behaviour); that `preventDefault` on pointerdown does not block the long-press selection or the editable's Paste callout; whether a programmatic selection shows handles and Copy; the Paste callout over a transparent full-screen textarea; selection handles and keyboard interplay; Playwright WebKit on Linux has no native iOS selection UI.

## Notes for the lead

- Fixed risk to watch: pointerdown `preventDefault` is kept on touch (it suppresses compatibility mouse events, which matters for tmux mouse mode). If the iPhone shows no native selection or Paste callout, skip `preventDefault` for events whose target is inside `.terminal-touch-text` or the helper textarea first.
- `Terminal` no longer takes `onSelectText`; the long-press-opens-text-view behaviour is gone by design.
- Default `npx playwright test` runs only Chromium (no projects in playwright.config.ts); the touch spec also passes with `--browser=webkit`.
- Another process changed frontend/src/terminalKeys.ts and terminalKeys.test.ts while this step ran. Those edits are not mine and were left as found.
- Not done, by scope: native selection of scrollback, reporting native selection to the Clipboard menu's Copy selection button, mouse-reporting (tmux mouse mode) behaviour on touch.
