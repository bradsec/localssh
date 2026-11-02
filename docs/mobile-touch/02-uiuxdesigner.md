# Mobile terminal and touch interaction design

Designing: browser SSH workbench for LAN users working in a shell, vibe calm and precise, on iPhone Safari, design system `DESIGN.md`. Surface: form-heavy app. Mode: Operate. Redesign mode: targeted refinement.

## Design read and evidence

ID | DECISION | CONFIDENCE | EVIDENCE
--- | --- | --- | ---
D-01 | VARIANCE 2/10: keep conventional task geometry; terminal output remains the visual focus. | HIGH | The active target and existing tab model already organize work in `DESIGN.md`.
D-02 | DENSITY 8/10: reserve each visible row for session identity, input, or output. | HIGH | At 390x844, the current capture spends about 92px on toolbar and tabs before output, then a persistent key bar at the bottom.
D-03 | MOTION 1/10: change chrome states instantly; feedback uses brief color changes. | HIGH | Terminal refits on viewport changes; moving controls during typing would shift the shell.
D-04 | The active SSH target remains the fixed point; on phone it also opens the session switcher. | MED | Reuses the existing target and tabs without a second top row; no physical iPhone test yet.
D-05 | Primary action in a live session is shell input; `Actions`, `Files`, and other controls stay secondary. | HIGH | `App.tsx` and `PRODUCT.md` define the terminal as the work area.

Material, real: `PRODUCT.md` security and audience facts; `DESIGN.md` tokens and IA; current React UI, xterm.js terminal, key bar, Clipboard menu, Files, Help, and screenshots in `docs/redesign/02-after/`.

Material, absent: iPhone Safari captures with the keyboard open, landscape captures, measured task completion, native selection proof, and user research. The `127.0.0.1` screenshot target is test data.

Idea: On this app, the active SSH target becomes the compact session control that gives space back to the shell. Competitor test: any multi-session SSH client could use a target switcher; the distinctive constraint here is a browser terminal whose usable height changes with Safari chrome and the software keyboard. The idea is useful but not a claim of unique branding.

## Current audit

ID | SEVERITY | CONFIDENCE | SCREEN | PROBLEM | FIX
--- | --- | --- | --- | --- | ---
A-01 | HIGH | HIGH | Phone session, `App.tsx` and `.app-toolbar`/`.terminal-tabs` | Toolbar plus tab strip occupy at least 92px before safe-area padding, even with one session; the screenshot confirms two full rows. | Use one 44px session row for target and `Actions`; open a session switcher from the target.
A-02 | HIGH | HIGH | Phone terminal selection, `Terminal.tsx` and `.terminal-host` | `pointerdown.preventDefault()`, `touch-action: none`, `user-select: none`, and `-webkit-touch-callout: none` block Safari selection; current long press selects xterm cells without native handles. | Make displayed output genuinely browser-selectable on iOS; let Safari own long press, handles, and Copy.
A-03 | MEDIUM | HIGH | Phone shell with keyboard, `viewportHeight.ts` and `app.css` | Visual viewport height and offset are tracked, but persistent header, tabs, key bar, and safe-area padding still subtract from output. | Keep viewport tracking; collapse session navigation and size the key bar against the visible viewport.
A-04 | MEDIUM | MED | Landscape with keyboard | No orientation-specific session rule appears in CSS; a short visual viewport can leave very few terminal rows. | Use the same single session row, one-row key bar, and a minimum usable terminal area rule; validate on device.
A-05 | MEDIUM | HIGH | Touch gestures, `terminalGestures.ts` | Horizontal swipes send Tab/Esc and prompt-area flicks send arrows; these compete with selection and familiar one-finger scroll. | Make one-finger vertical drag scroll output and long press select; use visible key bar controls for shell keys.
A-06 | MEDIUM | HIGH | Clipboard, `ClipboardMenu.tsx` | Copy is hidden inside `Actions` and then `Clipboard`; manual copy appears only after browser clipboard failure. | Show system Copy on a native terminal selection; retain Clipboard for paste and fallback copy.
A-07 | LOW | HIGH | Desktop session | Desktop has direct toolbar actions and tab strip; the complaint concerns touch screens. | Keep desktop toolbar, tabs, keyboard behavior, and pointer selection unchanged.

The existing visual system, connect form, host-key sheet, Files replacement view below 920px, 44px touch controls, and viewport-offset handling are useful. Preserve them. `DESIGN.md` governs colors, typography, copy, labels, URLs, and security wording.

## Information architecture and flow

ID | DECISION | CONFIDENCE | EVIDENCE
--- | --- | --- | ---
F-01 | Connect and host-key screens keep their current order and labels; this change begins when a terminal is active. | HIGH | The reported height problem is in the session; connect needs ordinary page scrolling above the keyboard.
F-02 | Phone session question: “Which server receives my input?” Answer with full `user@host:port`, connection state, and an obvious switcher affordance. | HIGH | Multiple live tabs send input to separate SSH sessions.
F-03 | Tap target to open `Open terminals`; choose a session or `New terminal`; return to the terminal without disconnecting the previous session. | HIGH | Existing tabs and `New terminal` action already support this flow.
F-04 | Tap `Actions` for existing `Files`, `Disconnect`, `Clipboard`, `Appearance`, `Help`, and `About` controls. | HIGH | Existing `ActionsMenu` uses these controls below 1024px.
F-05 | Long press output, adjust native selection handles, use system Copy; tap terminal to focus input; use Clipboard for Paste or fallback. | LOW | Native handles require a selectable DOM output surface and physical Safari validation; current xterm output does not provide that contract.
F-06 | `Files` still replaces terminal below 920px; its close control returns to the same session. | HIGH | Existing per-tab file panel behavior.

No navigation label, route, copy voice, analytics event name, logo, or legal text changes. `Open terminals` already names the tablist for assistive technology. The proposed visible switcher may show that same label. Do not present an extra primary button beside shell input.

## Phone layout

ID | DECISION | CONFIDENCE | EVIDENCE
--- | --- | --- | ---
L-01 | Portrait session grid: top safe area, one session row, flexible terminal viewport, one horizontal key bar, bottom safe area. | HIGH | Current shell already uses the visual viewport and safe-area insets.
L-02 | Session row is 44px minimum, with a target switcher taking remaining width and a pinned 44px `Actions` control at the right. | MED | Reclaims one 44px tab row; the target remains the main orientation cue.
L-03 | Target switcher shows `user@host:port` plus text state and chevron; allow two lines for long targets, up to a 60px row. | MED | Current `DESIGN.md` requires phone target wrapping rather than clipping; exact long-target cases need device review.
L-04 | Keep `localssh` in the connect toolbar and About; omit the standalone wordmark from the active phone session row. | MED | The live target is more useful while typing, but this changes an existing `DESIGN.md` phone rule.
L-05 | Session switcher is a short sheet or anchored list inside the visual viewport, not a second permanent row. Each entry shows host, full target, and text state. | MED | Reuses existing tabs, active underline/weight, close controls, and `New terminal` action.
L-06 | With keyboard open, keep the session row and key bar visible. The terminal gets every remaining pixel; no auto-hide while typing or selecting. | HIGH | Hiding controls on terminal scroll would make recovery and session identity harder.
L-07 | Landscape uses the same structure. The switcher overlays terminal output; the key bar stays one row and scrolls horizontally. | MED | No landscape capture exists; the visible viewport height determines whether this is sufficient.
L-08 | The key bar starts with Keyboard, Ctrl, Alt, Up, Down, Enter, Backspace, Esc, Tab; preserve remaining existing keys in horizontal scroll. | MED | Current key order already places these first, except the keyboard/modifier group; test reachability with one hand.
L-09 | Keep `Actions` pinned while the target wraps. Menus and sheets must not overflow the visual viewport or sit behind the keyboard. | HIGH | Current Actions menu already closes on outside interaction and is used at compact widths.

Portrait, single or multiple sessions:

```text
top safe area
| [Connected  user@host:port  v] | [Actions] |
| terminal output and prompt, fills remaining space |
| terminal output and prompt                         |
| [Keyboard] [ctrl] [alt] [↑] [↓] [⏎] [⌫] ...  > |
bottom safe area when keyboard is closed
system keyboard when open
```

Switcher open:

```text
| active target                     | Actions |
| Open terminals                      Close |
| selected  host A  user@host:port Connected |
|           host B  user@host:port Connected | Close host B terminal
| New terminal                              |
| terminal stays behind the sheet           |
```

The drawings show roles, not new final copy. Use existing tab labels and action names. A close control must not overlap the row that selects its session. The active session marker needs text or weight in addition to color. If a single session exists, the switcher still exposes `New terminal` and close without a permanent tab row.

Landscape, keyboard open:

```text
top safe area | [target v]                 [Actions] |
              | terminal, at least usable prompt rows |
              | [Keyboard][ctrl][alt][↑][↓][⏎] ... |
              | iOS keyboard                       |
```

If physical iPhone testing shows fewer than three visible terminal rows, offer an explicit `Hide keyboard` control in the existing key bar and keep it reachable. Do not silently hide the header or key bar. Three rows is a design review threshold, not a measured platform guarantee.

## Terminal touch contract

ID | DECISION | CONFIDENCE | EVIDENCE
--- | --- | --- | ---
T-01 | One-finger vertical drag moves scrollback; lifting ends the scroll. It must never send Up/Down to the SSH host. | MED | Scroll is the common reading gesture; current prompt flicks can send cursor keys.
T-02 | One-finger horizontal drag must not send Tab/Esc in the native selection path. Use visible `tab` and `esc` keys. | MED | Hidden gestures can fire during handle adjustment; visible controls already exist.
T-03 | A stationary long press on visible output starts Safari selection, shows native handles, and offers system Copy. Dragging handles extends selection across wrapped lines and scrollback. | LOW | Current canvas-style xterm output is not browser-selectable; this requires technical proof on iPhone Safari.
T-04 | Selection must show exact terminal text in visual order, preserving spaces, line wraps, and Unicode; no ANSI control bytes or hidden accessibility text enter the copy. | LOW | A DOM selection surface must map xterm buffer content accurately; no implementation was tested.
T-05 | While selecting, terminal input and custom gestures pause; the keyboard may dismiss, but selection and handles remain. Tapping clear output ends selection and restores ordinary tap-to-focus. | LOW | Native selection ownership and focus interplay need device validation.
T-06 | Use system Copy first. After copy, retain the scroll position; do not auto-paste into the shell or disconnect. | MED | Copy is a read action; the existing Clipboard flow already treats paste separately.
T-07 | Keep `Clipboard` in `Actions` for paste and a manual copy fallback when Safari cannot offer native selection. The fallback must label its limit. | HIGH | Plain HTTP LAN deployments can block async clipboard access; the existing textarea route handles that case.
T-08 | Do not claim native handles from xterm `term.select()` alone; it creates an xterm selection, not browser `Selection` handles. | HIGH | Current `Terminal.tsx` code explicitly suppresses native callout and calls `term.select()`.

Implementation gate for the engineer: prove a selectable output representation can align with xterm, including scrollback, alternate screen applications, rapid output, resizing, and font changes. Keep the current xterm selection and Clipboard route until the native path passes device checks. If that proof fails, surface the limitation to the product owner; a read-only selectable output view is the fallback design, not a claim that terminal long press meets the request.

## States and interaction

ID | DECISION | CONFIDENCE | EVIDENCE
--- | --- | --- | ---
S-01 | No session: keep current connect view and empty copy; do not show a session row or key bar. | HIGH | Existing `App.tsx` state.
S-02 | Connecting: show existing `Connecting to <host>...` in switcher; `New terminal` remains disabled during the pending connection. | HIGH | Existing tab state and labels.
S-03 | Connected: target and `Connected` remain legible; terminal accepts input. | HIGH | Current session identity.
S-04 | Disconnected tab: show `Disconnected` with `Unplug` in switcher; preserve close and recovery paths. | HIGH | Existing dropped-tab contract in `DESIGN.md`.
S-05 | One/many sessions: no permanent tab row; switcher entries preserve selected, unselected, focused, and close states. | MED | Saves height while keeping session navigation.
S-06 | Keyboard closed/open: key bar remains visible; Keyboard button states `Show keyboard`/`Hide keyboard`; terminal refits to visual viewport without panning the page. | HIGH | Existing `KeyBar` and `viewportHeight.ts` behavior.
S-07 | Selecting: native highlight, handles, and system Copy take precedence; key bar remains stationary and does not clear selection on a resize. | LOW | Native behavior unverified; existing resize preservation only applies to xterm selection.
S-08 | Clipboard blocked: keep current manual text field and feedback; never report copy success unless browser confirms it. | HIGH | Existing Clipboard menu behavior.
S-09 | Files open: Files replaces terminal on phone; session row identifies the same target, and file panel close restores it. | HIGH | Existing per-tab Files behavior.
S-10 | Input error/session loss: keep existing error text and toast; do not let a compact header hide recovery content or `Actions`. | HIGH | Existing `App.tsx` error branches.
S-11 | Actions/switcher open: Escape, outside tap, and explicit close dismiss; focus returns to the opener, and scroll stays confined to the open panel. | MED | Current Actions menu supports part of this; switcher behavior is proposed.
S-12 | Controls: default, hover where applicable, visible focus, pressed, disabled, loading, and error states use existing `DESIGN.md` treatment. | HIGH | Existing design system.

Interaction timing: 120ms color feedback only; switcher may use the existing 160ms overlay entrance if it does not move the terminal. No animation for keyboard, terminal fit, tab change, or selection. Under `prefers-reduced-motion`, make transitions instant.

## Responsive and accessibility handoff

ID | DECISION | CONFIDENCE | EVIDENCE
--- | --- | --- | ---
R-01 | Apply the single-row session pattern below 720px; from 720px to 1023px keep the existing Actions toolbar and tab strip unless touch testing shows the same height failure. | MED | Existing breakpoints and screenshot cover phone width only.
R-02 | At 320px, keep target and Actions separate with 44px hit regions; target may wrap to two lines, never overlap or clip. | HIGH | Existing phone rule already requires wrapping.
R-03 | Honor top, bottom, left, and right safe-area insets; landscape side insets must not cover the switcher, key bar, or selection handles. | HIGH | `viewport-fit=cover` and current CSS safe-area usage.
R-04 | Use `visualViewport.height` and `offsetTop` for the active session; keep connect form scrolling in the layout viewport. | HIGH | Current code already separates these behaviors.
R-05 | Keep each touch target at least 44 by 44 CSS px in this web UI. | MED | `DESIGN.md` already uses 44px; Apple specifies 44pt for native controls, which is guidance rather than a direct CSS-pixel equivalence.
R-06 | Preserve visible focus and keyboard operation for target switcher, Actions, session entries, close controls, and key bar. | HIGH | WCAG 2.2 focus and keyboard criteria apply to web controls.
R-07 | Text and control contrast must meet existing `DESIGN.md` token checks and rendered WCAG 2.2 AA checks. Color alone cannot identify active, disconnected, or modifier states. | HIGH | Existing design system and WCAG 2.2.
R-08 | Hand physical iPhone portrait and landscape, keyboard open/closed, VoiceOver, zoom, native selection handles, scrollback, and safe-area edge checks to an accessibility auditor. | HIGH | Chromium screenshots and source inspection cannot prove iOS interaction.

Sources accessed 2026-11-02: [WCAG 2.2 target size minimum, SC 2.5.8 AA](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum); [WCAG 2.2 specification, focus visibility and focus not obscured](https://www.w3.org/TR/WCAG22/); [Apple Human Interface Guidelines, Buttons, platform touch guidance](https://developer.apple.com/design/human-interface-guidelines/buttons); [MDN VisualViewport API, web viewport scope](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport); [xterm.js mobile touch limitation proposal, project issue #5377](https://github.com/xtermjs/xterm.js/issues/5377). The xterm issue is evidence of a reported limitation, not proof that a specific local implementation fails on every device.

## Proposed `DESIGN.md` delta for implementer

ID | SECTION | PROPOSED DELTA | CONFIDENCE
--- | --- | --- | ---
M-01 | System | Keep Operate, calm/compact/precise, and the active-target idea; add “phone session target is the session switcher.” | MED
M-02 | Tokens | Reuse current color roles, IBM Plex type, spacing 4/8/12/16/24/32, radii, elevation, 120ms feedback, and 160ms optional overlay. No new token. | HIGH
M-03 | Layout | Replace the session-phone toolbar plus 44px tab strip with one 44px minimum target/Actions row; permit 60px for a wrapped target; place tabs in an `Open terminals` switcher. | MED
M-04 | Layout | Keep desktop 56px toolbar and 48px tabs; keep 720px/1024px breakpoints, visual viewport sizing, and Files replacement below 920px. | HIGH
M-05 | Components | Target switcher gets open/closed, selected, focus, connecting, disconnected, close, and `New terminal` states. Keep labels and action semantics. | MED
M-06 | Components | Terminal output gains a selectable iOS touch surface only after a device proof; native handles and Copy are required acceptance behavior. | LOW
M-07 | Components | Key bar stays one horizontal row above keyboard and safe area; direct keys replace hidden horizontal and prompt-flick commands on iPhone. | MED
M-08 | Rules | On phone, one-finger drag is scrollback; long press is selection; touch gestures never silently send Tab, Esc, Up, or Down. Desktop behavior stays as is. | MED
M-09 | Open items | Prove native selection on xterm content, including alternate screen and resize; decide fallback if impossible. Verify landscape with keyboard and safe areas on physical iPhones. | LOW

This is a proposed delta. `DESIGN.md` itself stays unchanged in this step. The delta deliberately revises its current phone toolbar/tab-strip rule; the implementer must update that rule if the design is accepted.

## Validation questions

ID | QUESTION | CONFIDENCE | EVIDENCE
--- | --- | --- | ---
V-01 | Can iPhone users identify and switch the intended live target without a permanent tab strip? | LOW | No user test or analytics supplied.
V-02 | Do native handles appear and copy exact output after long press across wrapped and scrolled lines? | LOW | Requires a rendered selectable surface and physical Safari test.
V-03 | Does landscape leave enough visible prompt rows with the keyboard open on supported iPhones? | LOW | No landscape device capture supplied.
V-04 | Can users reach common key bar controls and hide the keyboard with one hand? | LOW | Current order is based on code rationale, not user observation.
V-05 | Does VoiceOver announce target, state, switcher, selection, and system Copy without duplicated terminal text? | LOW | Requires screen reader audit.

Not verified: physical iOS Safari behavior, native selection feasibility, rendered contrast in every state, landscape keyboard fit, and user task success. No code or root `DESIGN.md` change is part of this design step.
