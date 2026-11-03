# iPhone Safari editable terminal surface

Designing the live iPhone terminal for native selection, reliable paste, and keyboard continuity under Safari's single-focus and editable-gesture constraints.

## Requirements and evidence

The user requires double-tap word selection, adjustable handles, Copy, and tap-for-Paste with the keyboard shown and hidden. A Copy or Paste gesture must not open or close the keyboard as a side effect. Priority: correctness and security, keyboard continuity, then latency and implementation cost. Load is one local browser terminal per tab; throughput, team size, budget, deadline, and supported iOS versions are unspecified. No capacity estimate is needed. Existing React, xterm 6, DOM renderer, key bar, plain-HTTP relay, and read-only Select text view remain. The present split between `.terminal-touch-text` and xterm's textarea fails the reported keyboard-shown selection case [R1, R2].

**Critical feasibility gate, LOW confidence:** Safari may open the keyboard whenever a blurred editable root gains focus, even with `inputmode="none"`. No cited specification guarantees a single tap on an unfocused editable shows Paste or that `inputmode` changes suppress the keyboard on every iOS release [W2, R1]. The requirement is accepted as the target, not claimed as proven. Stop the full build if the device spike fails; keep the existing Select text fallback and bring the finding back to the lead.

## Architecture and ownership

```text
SSH output -> xterm buffer -> DOM rows (visual source)
                           -> iPhone editable mirror (native selection geometry)
iPhone editable mirror -> input bridge -> term.input -> existing onData -> SSH
                      -> paste -> term.paste -> existing onData -> SSH
desktop / mouse -> xterm helper textarea and current xterm input path
```

The iPhone surface is the existing `.terminal-touch-text`, changed to one full-size `div contenteditable="plaintext-only"` editing host. It has `inputmode="text"` while the key bar says keyboard shown and `inputmode="none"` when hidden. Set `autocorrect="off"`, `autocapitalize="off"`, `spellcheck="false"`, and `enterkeyhint="enter"`; verify the last two modes on the target Safari. Keep its effective opacity 1, non-tiny geometry, and unclipped bounds. Keep text visually transparent through `color`, with native selection highlight and handles visible. Remove its `aria-hidden`, which conflicts with a focused control. Give it a concise accessible name, for example “Terminal input and text selection”. Keep xterm's accessibility rows and live region as the sole announced output; mark only the mirrored output subtree `aria-hidden="true"` after confirming VoiceOver still exposes native selection. If that hides selectable text from VoiceOver, gate the mirror interaction for VoiceOver and use xterm's accessibility tree plus Select text. Do not hide the editing host itself.

The root has two children: cloned visible xterm rows and one prompt-side input island within the same editing host. The island has real, row-sized hit geometry at the prompt, an empty text node and caret, and no painted box. Put the caret there on keyboard-toggle Show and after sent input. Ordinary taps on output may place a native caret there; paste from any collapsed caret still routes to the shell. Keep the selected range untouched until the user dismisses it. On a tap at the caret, leave default Safari behavior intact so the native Paste menu can appear. Never synthesize a menu or use `navigator.clipboard` on HTTP.

Use `syncVisibleRows` for unchanged rows. Freeze all mirror DOM edits while a range is non-collapsed, the caret lies in a row about to change, a native menu is active, or composition is active. Queue the newest xterm frame only; after selection/composition ends, replace changed rows and restore a collapsed caret to the island. Never replace a selected node or force blur to resync. A long-lived range can make the mirror stale; label copied text as a snapshot of what the user selected, and refresh on dismissal. Scroll/resize also wait if they would invalidate that range. Output is never authoritative input and the browser's editing operations must never overwrite it.

The input bridge owns `beforeinput`, `input`, `compositionend`, `paste`, and hardware `keydown` on this root. For cancelable `insertText`, dictation text, `insertLineBreak`/`insertParagraph`, and `deleteContentBackward`, prevent default and send exactly one `term.input(data)`, `\r`, or `\x7f`. Reject edits to selected output: typing clears the selection and sends the keystroke without replacing copied rows. Prevent other edit operations, including cut, format, history, and autocorrect replacements. Disabling autocorrect reduces replacement events; if Safari still produces one, do not guess terminal backspaces from a DOM range. Tell the user that candidate replacement was ignored and allow fresh typing. Handle hardware arrows, Escape, modifiers, and shortcut keys in the root's keydown path through the existing terminal key mapping; prevent their browser defaults. Do not also send their subsequent `beforeinput`. Route pasted plain text through the existing capture listener and `term.paste` once, canceling propagation before xterm's paste listener. Ignore the matching `insertFromPaste` and `input` events for that same paste transaction. Preserve xterm bracketed paste.

Composition is the exception to no DOM mutation: `insertCompositionText` can be noncancelable [W1]. Keep the composition range inside the unpainted prompt island, allow transient IME mutation there only, and consume no intermediate text. On `compositionend`, read the committed island text, send one `term.input`, clear the island before paint, and restore its caret. An `input` fallback handles noncancelable dictation or missing `beforeinput` by reading only the island delta, sending it once, and clearing it before paint. Track each native edit transaction by event sequence and final value so `compositionend`, trailing `input`, and keyboard events cannot each send the same text. If Safari mutates a mirrored row, restore that row immediately and report an unsupported path; do not transmit inferred deletions. Unit and device tests must prove the event sequences. If IME cannot be confined to the island, this architecture fails its non-mutation requirement and needs a new design decision.

xterm's helper textarea remains in the DOM for xterm rendering and desktop/hardware paths, but iPhone touch mode makes it inert for focus, pointer input, tab order, and paste. `term.focus()` and `term.blur()` in `Terminal`'s control handle must target the editable root on iPhone, including App's keyboard toggle, tab switching, and panel restoration. Report focus from that root to `onFocusChange`; suppress duplicate focus changes. Do not programmatically focus xterm's textarea on iPhone or let xterm's mousedown handler reclaim focus. Hardware keyboards on iPhone use the editable root's key bridge. Desktop and mouse use xterm's untouched textarea and native key handling. Keep the existing xterm accessibility manager; confirm its focus reporting and cursor style still make sense when its textarea is unfocused [X1].

`attachGestures` must stand down for taps, double-taps, long press, selection handles, and caret movement on the root. Do not call `preventDefault`, pointer capture, `term.focus()`, or the 600 ms word-selection fallback on those gestures. Preserve swipe keys only for gestures that begin outside the editable text hit region and have crossed the existing threshold. Preserve scrollback through a dedicated touch gesture region or a proven two-finger path; do not hijack a handle drag. Keep `touch-action` and ancestor `user-select` overrides under device test, because the current host disables defaults [R3]. Key bar buttons retain their press focus protection; Show/Hide alone changes keyboard intent. Hide may explicitly blur and Show may explicitly focus, but Copy and Paste must never toggle. A hidden-state tap must focus with `inputmode="none"` and leave the keyboard hidden, or the spike fails.

## Decision log

| ID | Decision | Why and confidence | Rejected / consequence / revisit if |
| --- | --- | --- | --- |
| D1 | One iPhone editable mirror, xterm still renders and owns protocol, reversible | Editable WebKit gestures need one focus owner; MED [R1, W1] | Split mirror/textarea keeps focus conflict; introduces an input bridge; revisit if spike fails. |
| D2 | Keep xterm textarea inert only on iPhone, reversible | Its focus and paste listeners otherwise compete; HIGH for source behavior [X1] | Replacing xterm internally risks upgrades; hardware keys need a local bridge. |
| D3 | Use `term.input` for keys and `term.paste` for paste, reversible | Both feed xterm's existing data path; HIGH for installed xterm 6 [X1] | Direct socket writes bypass xterm paste policy; key mapping must stay complete. |
| D4 | No server or data-model change, reversible | Selection is a browser-local snapshot; HIGH [R2, R3] | No cross-device clipboard sync or scrollback-wide native selection. |
| D5 | Hidden-mode `inputmode="none"` and same root, experimental | Best small path to Paste without keyboard motion; LOW [W2] | Safari may ignore it or require a second tap. Device failure blocks rollout. |

No public data contract or one-way-door migration is proposed. The main new failure modes are duplicated input, stale copied output, IME corruption, and lost keyboard continuity.

## Gesture contract

| Gesture | Keyboard shown | Keyboard hidden |
| --- | --- | --- |
| Double-tap output word | Native word range, handles; Copy on selection or next tap; keyboard stays shown | Same; `inputmode=none` focus must keep keyboard hidden |
| Drag handles | Extend range; send no shell key or scroll | Same |
| Tap selected range | Show Copy; no focus swap | Same |
| Tap caret with clipboard text | Native Paste menu; `term.paste` once; keyboard stays shown | Native Paste menu from same root; keyboard stays hidden |
| Long press output | Native selection/loupe, no JS fallback | Same |
| Tap ordinary terminal text | Native caret, no shell input | Native caret, no keyboard opening |
| Key bar Hide/Show | Explicitly hide | Explicitly show |
| Swipe key / scroll | Existing behavior only outside selection and editable gesture | Same |

For an initially blurred root, first tap may only place the caret. Apple documents a possible second tap for Paste; a strict single-tap contract is **SUSPECTED** until the iPhone spike proves it [R1]. The test must record initial focus separately from keyboard visibility. A design that meets Copy but needs an extra tap for Paste does not meet the stated target.

## Failure, security, cost, and operation

There is no new service, storage, quota, or paid dependency. The browser mirror costs one copy of visible rows per iPhone tab, not all 5,000 scrollback lines [R3]. If output arrives during selection, the visual terminal continues while its copy pauses; the status is eventual consistency until selection ends. Input and paste are ordered through the existing xterm `onData` path. If the SSH link is down, current session error handling remains authoritative; the mirror must not queue or replay edits. No retry can safely infer whether a shell accepted prior input.

Treat terminal output and clipboard content as untrusted text. Clone DOM text, never parse output as HTML. Keep `contenteditable=plaintext-only`, cancel rich paste, and send only `text/plain`; do not log copied or pasted content. A compromised browser origin can already read terminal output and input; this change does not alter that trust boundary. Scope document listeners and teardown to the terminal instance, and block input when the tab is inactive. Observe only counts and event types in local debug builds; do not record payloads. Deploy behind the existing iPhone/coarse-pointer path, verify the release on-device, and roll back by removing the editable-root branch. No backfill or dual-write exists.

## Build sequence and proof

1. **Throwaway device spike, before production edits:** make the existing mirror a full-size `contenteditable="plaintext-only"` root with opaque geometry, `inputmode="none"` for hidden state, and xterm textarea unfocused. On a physical iPhone, prove double-tap word, handles, Copy, and tap-for-Paste with clipboard text in both starting keyboard states. Record focus, keyboard motion, gesture count, and exact copied text. If hidden-state tap raises the keyboard, keyboard-shown Copy loses handles, or Paste needs more than one tap, stop. Keep Select text fallback; ask the lead to revise the UX requirement or approve another native interaction path.
2. Add the input island and event bridge. Test each event sequence and exactly-once SSH output before enabling normal typing.
3. Move iPhone focus ownership to the root; update App controls, key bar state, pointer gestures, CSS, and accessibility. Keep desktop untouched.
4. Add mirror freeze/resync, resize and scroll handling, and cleanup. Remove the now-redundant prompt-row textarea overlay only after device proof.
5. Update README/user guide and run focused unit, Playwright, and device checks. Release only after physical iPhone passes.

Unit tests: unchanged-row identity; selection and caret preserved across output; deferred resync; `beforeinput` mappings; IME and dictation sequences; autocorrect rejection; Backspace/Enter; paste exactly once including bracketed mode; inactive tab. Playwright WebKit touch: editable geometry and CSS, focus owner, tap/scroll/swipe isolation, key bar toggle, event routing, no duplicate paste, and no desktop regression. Linux WebKit does **not** prove iOS callouts, handles, or keyboard motion [R1].

Five-minute iPhone script: (1) Record model, iOS/Safari version, HTTP URL; copy `alpha beta gamma` from Notes and connect. (2) Keyboard hidden: double-tap `beta`, drag handles through `gamma`, Copy, paste into Notes, and check exact text and unchanged keyboard. (3) Return to prompt, tap the same caret location once, choose Paste, verify one shell insertion and no keyboard opening. (4) Press Show keyboard; repeat double-tap, handle drag, Copy, and Notes check without keyboard flicker. (5) With keyboard shown, tap caret once, Paste, confirm one insertion and bracketed paste in a capable shell/editor. (6) Type, Backspace, Enter, use dictation and one IME if available; scroll and key bar swipe; watch for duplicate bytes, stale selection, focus loss, and keyboard movement. Record every extra tap or flicker as failure.

## Verification and handoff

Engineering: confirm installed xterm 6 `input`, `paste`, textarea focus, and accessibility interactions against the pinned package before coding [X1]. Security/accessibility: inspect VoiceOver once the root is interactive, plus text-only paste and inactive-tab isolation. No database role is needed. There are no vendor quotas or prices to check. Browser behavior claims remain LOW until the target iPhone test; recheck Apple/WebKit behavior for each supported iOS release. No current capacity benchmark was measured.

Evidence, accessed 2026-11-03 unless noted:

- [R1] [iPhone editing research](24-researchanalyst-ios-text-editing.md), source retrieval 2026-11-02, including Apple/WebKit primary links and device observations supplied in the brief. Research inference is not device proof.
- [R2] [Focus rectangle diagnosis](24-debugengineer-focus-rectangle.md), local CSS and Linux browser verification, 2026-11-02; iPhone paint not verified.
- [R3] [Current implementation report](20-featurebuilder-native-select-paste.md) and local `frontend/src/terminalTouch.ts`, `frontend/src/components/Terminal.tsx`, `frontend/src/components/KeyBar.tsx`, `frontend/src/app.css`, branch `fix/ios-copy-paste`, inspected 2026-11-03.
- [X1] Installed `frontend/node_modules/@xterm/xterm/src/browser/CoreBrowserTerminal.ts` and `src/common/CoreTerminal.ts`, xterm 6, inspected 2026-11-03; local source is the version authority.
- [W1] [W3C Input Events Level 2](https://www.w3.org/TR/input-events-2/), Working Draft, accessed 2026-11-03; composition updates are not cancelable, and replacement input types are defined. Safari conformance unverified.
- [W2] [HTML `inputmode` reference](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inputmode), accessed 2026-11-03; `none` requests no virtual keyboard, but does not prove iPhone Safari's focus/menu behavior.
