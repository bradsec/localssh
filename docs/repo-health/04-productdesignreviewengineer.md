# Repository health: product design review

Reviewed 2026-10-31 on `review/2026-10-31`, full audit mode. The worktree was clean at entry. The lead will commit these changes. This pass did not create a branch or commit.

Reading this as: an SSH workbench for technical users, restrained and dependable, leaning on terminal typography and clear controls.

## Design read and scope

Mode: **Operate** for the connect page, saved-host vault, session toolbar, terminal, Appearance, and About. `PRODUCT.md` and root `DESIGN.md` did not exist at entry. The new `DESIGN.md` records decisions below. Brand uses IBM Plex Sans, IBM Plex Mono for chrome, an indigo-grey accent, rounded panels, Material Symbols outlined toolbar icons, and a terminal bezel tied to Tokyo Night. Light and dark UI follow the system; terminal themes are chosen separately. The terminal and touch key bar give the product a concrete signature. The connect page uses familiar form structure, which serves this operating task. I found no substantiated AI-gradient, fake-proof, typography-default, or ornamental-layout defect.

Before and after captures are in [`04-screens/`](04-screens/): phone 390×844, tablet 768×1024, desktop 1440×900, each on connect and terminal. Dark connect captures cover phone and desktop. Captures use Chromium, with touch emulation at phone and tablet sizes. The original supplied `screenshot1.png` and `screenshot2.png` were also inspected. The running browser test started a local SSH test server and relay, then connected through the page. Source-only concerns below are labeled.

## Findings

ID | SEVERITY | file:line or page/section | problem | proposed fix
--- | --- | --- | --- | ---
D-01 | CRITICAL | `frontend/src/app.css:497`, `frontend/src/components/ConnectDialog.tsx:119`, before phone and desktop connect captures | HIGH confidence: optional vault occupied the first action area; the Connect button was below the phone viewport and cut by the desktop panel's scroll edge. | Put connection details first in DOM and visual order; let the connect page scroll normally. Applied.
D-02 | HIGH | `frontend/src/clipboard.ts:38`, `frontend/src/components/ClipboardMenu.tsx:54`, clipboard stress route | HIGH confidence: when automatic copy failed, the menu offered no selectable fallback; its staging textarea also moved focus outside and closed the menu. The scratch route reproduced the closure. | Keep the menu open through staging focus, restore prior focus, and show a read-only selection with a manual Copy instruction. Applied.
D-03 | MEDIUM | `frontend/src/app.css:88,1440`, Clipboard menu | SUSPECTED, MED confidence: the paste textarea lacked the project's explicit focus outline and used 12.8px text. The browser's own focus indicator was not separately measured. | Apply the shared focus outline and a 16px field floor. Applied.
D-04 | MEDIUM | `frontend/src/app.css:76,278,602,842,979,1338,1408`, tablet capture | HIGH confidence: toolbar controls measured 36px and key controls 42px high at 768px, short of the stated 44px touch target. WCAG 2.2 AA uses a 24px minimum with exceptions; 44px is the product's touch target. | Set controls, vault segments, the About link, and clipboard actions to at least 44px across widths. Applied.
D-05 | MEDIUM | `frontend/src/components/About.tsx:37`, `frontend/src/App.tsx:272` | SUSPECTED, MED confidence: About offers product facts and source, but no in-app task help or link from connection, vault, or clipboard errors. | Add toolbar and contextual help entry points in the later in-app help step. Deferred by step ownership.

Escalation order: D-01, D-02. D-02 includes a failed action without a recovery path. D-03 is not claimed as an inaccessible focus state because native focus styling was not measured. No other trigger was confirmed.

## Fix roadmap and decisions

D-01 | Reorder existing sections and remove the nested scroll constraint | S | LOW risk: connection and vault order changes; browser tests cover both.
D-02 | Keep clipboard fallback focus inside the open interaction and expose selected text | S | LOW risk: temporary focus and selection must survive copy failure.
D-03 | Reuse the focus token and 16px field floor | S | LOW risk: textarea height may grow slightly.
D-04 | Use one 44px control floor | S | LOW risk: denser layouts lose a few pixels of vertical space.
D-05 | Add help where the user decides or recovers | M | LOW risk when the later step supplies content.

Direction to retain: the terminal as the instrument, IBM Plex Sans with mono chrome, the existing indigo-grey accent, one light/dark UI system, and the touch key bar as the signature interaction. Improve typography and spacing before changing color or rebuilding sections. No palette, logo, nav label, form field name, URL, legal copy, or analytics ID changed. The new `DESIGN.md` records system, tokens, layout, components, rules, and open items.

## Usability assessment

Judgment pass: the shell and touch controls are specific to SSH use; the connect form is conventional but clear. Evidence pass: the original form placement obscured Connect, and a failed copy had no usable fallback. Those facts outrank the otherwise positive visual read.

Nielsen heuristic | Score / 4 | Evidence
--- | --- | ---
Visibility of status | 3 | Toolbar states Offline, Connecting, Connected; host-key prompt and error alert expose transitions.
Match to the task | 4 | Host, port, username, password, terminal, and shell keys use expected language.
User control | 3 | Disconnect and vault controls exist; the terminal offers copy and paste actions.
Consistency | 3 | Shared toolbar and form styles; before D-04, touch heights varied by width.
Error prevention | 3 | Required fields, port range, and host-key verification precede connection.
Recognition | 3 | Labeled fields and buttons; gesture guidance lives in Appearance rather than at first use.
Flexibility | 3 | Saved hosts, font and theme choices, gestures, and touch key bar support repeat use.
Minimalism | 3 | Session view favors the terminal; optional vault previously crowded first connection.
Error recovery | 3 | The form permits retry; D-02 added a recovery route for blocked copy.
Help and documentation | 1 | About is informational; no task help is available inside the app. D-05.

Decision load: the connect form asks for four familiar fields, with the optional vault separated below. Appearance contains more settings, but the terminal task retains a default. No ungrouped decision point above four options was confirmed.

First-time visitor walk, SUSPECTED until user observation: the user can now reach Connect before deciding whether to create a vault; host-key verification may need contextual help. Power-user walk, SUSPECTED until user observation: touch selection and key bar support routine shell work, but the user may expect native iOS selection handles that the xterm canvas does not supply. Saved hosts remain reachable by page scroll. No real-user study was run.

## iOS, clipboard, and terminal evidence

- `frontend/src/components/Terminal.tsx:229-435` handles long press, drag selection, one- and two-finger scrollback, taps, and cancellation. `frontend/src/terminalGestures.ts:1-130` defines gesture thresholds. The existing Chromium touch test selected text, survived a viewport resize, and copied it. Native iOS handles were not observed.
- `frontend/src/viewportHeight.ts:46-95` publishes visual viewport height and offset without a React scroll render. `frontend/src/pageScrollLock.ts:33-51` blocks page pan only during a session while leaving scrollable descendants usable. Safe-area insets appear in toolbar, terminal, dialog, and key bar rules in `frontend/src/app.css`. The connected phone capture showed the key bar and terminal without horizontal overflow.
- In a real non-localhost HTTP browser origin, Chromium returned `{"secure":false,"clipboard":false,"copied":true}` for `isSecureContext`, `navigator.clipboard`, and a staged `execCommand("copy")` check. On localhost, `isSecureContext` was true. Unit tests cover blocked read and manual paste; the scratch route covered failed copy, focus, and manual selection. The insecure-origin check did not run a live SSH session.
- WebKit's [Async Clipboard API guidance](https://webkit.org/blog/10855/async-clipboard-api/), accessed 2026-10-31, covers secure contexts, user activation, and iOS paste callouts. [Safari 27.2 release notes](https://webkit.org/blog/18515/webkit-features-for-safari-27-2/), accessed 2026-10-31, record a transient-activation clipboard fix. The [xterm.js mobile issue](https://github.com/xtermjs/xterm.js/issues/5377) and [touch copy issue](https://github.com/xtermjs/xterm.js/issues/3727), accessed 2026-10-31, describe native selection and mobile support limits; they do not prove localssh fails on current iOS hardware.
- [Apple button guidance](https://developer.apple.com/design/human-interface-guidelines/buttons?changes=la_11), accessed 2026-10-31, gives a 44×44 pt hit-region rule for Apple platforms. [WCAG 2.2 SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum), accessed 2026-10-31, specifies 24×24 CSS pixels with exceptions. The 44px product floor is stricter than that web minimum.

## Verification

- Before and after screenshots: `04-screens/before-{phone,tablet,desktop}-{connect,terminal}.png`, matching `after-*`, plus `after-{phone,desktop}-connect-dark.png`. The after phone and desktop Connect buttons were within their initial viewports. No horizontal document overflow appeared at tested widths. The 320×700 browser test also kept Connect in view and could scroll to Saved hosts.
- Measured light token contrast, foreground/background: body 16.18:1, muted form label 6.12:1, primary button 5.21:1. Dark: body 13.67:1, muted form label 7.64:1, primary button 7.15:1. These are computed token pairs, not a full pixel audit. Dark and reduced-motion modes were rendered in Chromium; the CSS reduced-motion rule disables animation and transitions.
- Clipboard stress route imported the unchanged `ClipboardMenu` component and ran empty, one word, typical, several sentences, a 500-character unbroken string, and emoji/mixed RTL/tall-script text at 320px and 1400px. It checked disabled and failed-copy states, full field value, menu openness, and horizontal bounds. It found D-02, then passed after the fix. Quantity was dropped: this component receives one selection string, not a collection. Squeezed sibling and native clipboard callouts were not reproduced. The scratch route and fixtures were removed.
- Final engine: `Go test: 55 passed in 4 packages`; WASM vet exit 0; `built dist/engine.wasm, dist/wasm_exec.js, dist/testsshd`.
- Final relay: `found 0 vulnerabilities`; `Test Files  4 passed (4)`; `Tests  38 passed (38)`; lint and build exit 0; `All matched files use the correct format.`
- Final frontend: `found 0 vulnerabilities`; `Test Files  26 passed (26)`; `Tests  244 passed (244)`; `10 passed (7.1s)` in Playwright; lint and type check exit 0; `All matched files use the correct format.`; `✓ built in 1.20s`. The production JavaScript bundle still triggers Vite's 500 kB chunk warning.
- `git diff --check`: exit 0. `lighthouse` was unavailable, so no LCP, CLS, or INP measurement is claimed. Docker build failed once before build steps: `ERROR: failed to build: failed to update builder last activity time: open /home/mark/.docker/buildx/activity/.tmp-default1491017757: read-only file system`. No retry was made.

## Applied files and deferred work

D-01 -> `frontend/src/App.tsx`, `frontend/src/components/ConnectDialog.tsx`, `frontend/src/app.css`, `frontend/e2e/connect-flow.spec.ts`, `README.md`.
D-02 -> `frontend/src/clipboard.ts`, `frontend/src/components/ClipboardMenu.tsx`, `frontend/src/components/ClipboardMenu.test.tsx`, `README.md`.
D-03 and D-04 -> `frontend/src/app.css`.
Design decisions -> `DESIGN.md`.
D-05 -> deferred to the in-app help step, as directed.

Unverified: physical iPhone and iPad Safari selection handles, copy and paste callouts, software-keyboard transitions, safe-area behavior, 200% browser zoom, a full contrast sweep, LCP/CLS/INP, and both Docker images. The later DevOps step owns HTTPS LAN deployment; this pass kept a usable HTTP clipboard fallback. The relay image and live release workflow were not run here. The lead should run the hardware and Docker checks before closing those risks.
