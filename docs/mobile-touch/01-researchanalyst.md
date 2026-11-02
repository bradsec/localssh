# iOS terminal selection and background sessions

Researching: web terminal selection and iOS background execution to answer which renderer to use, how to offer native selection, and whether WebSockets survive backgrounding; for localssh's mobile design; out of scope: UI implementation, visual redesign, and font settings.

Retrieved 2026-11-02. Stars are snapshots, not quality measures. `FACT` means corroborated by independent sources; `PROBABLE` means one sound source or a stated inference; `SUSPECTED` means unverified. Source grades describe provenance, not truth.

| Question | Source types | Expected reliability | Disconfirming angle |
| --- | --- | --- | --- |
| Q1. Which emulator or xterm approach gives native iOS selection? | Upstream code, releases, issue reports, local implementation | A for code/releases; C for user reports | Search for DOM renderers that still fail iOS selection and for working non-xterm alternatives |
| Q2. Can iOS Safari or a home-screen app keep WebSocket/SSH alive in background or lock? | WebKit design/code, standards, bug reports, local transport | A for platform code/spec; C for bug reports | Search for supported background execution, workers, wake lock, and reports of connections surviving |

## Q1. Terminal and selection

**Conclusion, MED confidence:** Keep xterm.js 6. First offer a read-only native text selection view from its buffer; test direct DOM selection separately. Replacing the emulator has more integration risk, and no candidate has independently verified iPhone selection handles with localssh's SSH/TUI flow [F1-F5].

- **F1, FACT:** localssh already creates xterm with `screenReaderMode: true` and no renderer addon, while its terminal CSS sets `user-select: none`, `-webkit-touch-callout: none`, and `touch-action: none`; the pointer-down handler calls `preventDefault()` and implements its own long-press selection. xterm 6 documents DOM as its default renderer [S1, S2]. The CSS and event handling are direct blockers for Safari's native selection, even before considering xterm internals [S1].
- **F2, FACT:** xterm's open mobile issue says DOM rendering and/or `screenReaderMode` are prerequisites, not a complete solution. iPhone users reported DOM selection still failing in 2023; an xterm maintainer reported limited mobile testing [S3, S4]. An upstream native touch selection PR was still open on retrieval and its author reported a manual iPhone test, not an independent localssh result [S5].
- **F3, PROBABLE:** A separate selectable overlay over xterm, populated from the terminal buffer, has a 2026 implementation report [S4]. A dedicated **Select text** view is the simpler localssh experiment: show a frozen, read-only text snapshot in normal DOM text or a read-only text control, allow iOS selection handles and Copy, then close it to resume terminal input [S1, S4]. Preserve hard versus soft wraps where buffer metadata permits. Check alternate-screen content, Unicode, output arriving during selection, and scrollback truncation on a real iPhone. This is a design inference, not a tested localssh feature.
- **F4, PROBABLE:** Direct selection on xterm's DOM rows could avoid the extra view, but needs a scoped removal of localssh's suppression and changes to xterm gesture ownership. The open PR proposes selectable rows, bypassing internal touch selection when mouse reporting is off, and a visible-viewport input target [S5]. `screenReaderMode` supplies accessibility rows, not proof of native selection [S3, S4]. An overlay may preserve the terminal appearance, but requires coordination as rows update [S4, S5].
- **F5, PROBABLE:** wterm offers real DOM rows, native browser selection, and explicit copy logic, but those claims come from its own documentation. Its April 2026 iOS keyboard bug was marked fixed in September. Independent iPhone selection-handle verification and localssh VT/SSH compatibility remain unverified [S6, S7].

### Candidate screen

| Candidate | GitHub, stars, license, last release | Renderer and iOS selection evidence | Fit |
| --- | --- | --- | --- |
| xterm.js 6 | [xtermjs/xterm.js](https://github.com/xtermjs/xterm.js), **21,311**, MIT; [6.0.0, 2025-12-22](https://api.github.com/repos/xtermjs/xterm.js/releases/latest) [S2, S8] | Default DOM text, optional WebGL. DOM plus screen-reader mode alone has failed iPhone selection in user reports; native-selection PR remains open [S2-S5]. | Best base for a scoped selection view; already integrated [S1]. |
| wterm | [vercel-labs/wterm](https://github.com/vercel-labs/wterm), **3,569**, Apache-2.0; [v0.5.7, 2026-10-28](https://api.github.com/repos/vercel-labs/wterm/releases/latest) [S6, S9] | DOM text; optional image canvas overlay. Maintainer claims native browser selection and copy. iOS input fix landed 2026-09-27; selection handles unverified independently [S6, S7]. | Best replacement prototype if xterm route fails, subject to iPhone and TUI tests. |
| DomTerm | [PerBothner/DomTerm](https://github.com/PerBothner/DomTerm), **398**, repository `COPYING` has BSD-style terms but GitHub license is `NOASSERTION`; [3.2.0, 2024-01-25](https://api.github.com/repos/PerBothner/DomTerm/releases/latest) [S10] | DOM text. No current independent iOS selection evidence found [S10]. | Active commits, older release, license file audit needed before adoption. |
| jQuery Terminal | [jcubic/jquery.terminal](https://github.com/jcubic/jquery.terminal), **3,239**, MIT; [2.48.1, 2026-10-08](https://api.github.com/repos/jcubic/jquery.terminal/releases/latest) [S11] | DOM text; project calls mobile support experimental and recommends xterm for real SSH [S11]. | Not a drop-in SSH/TUI replacement. |
| hterm | [chromium/hterm](https://github.com/chromium/hterm), **348**, BSD-3-Clause; **no GitHub release**; npm `hterm` metadata is stale and the official code lives in Chromium libapps [S12]. | DOM text; no current independent iPhone selection result found [S12]. | Screened out pending current packaging and iOS proof. |

The stars, license metadata, activity and release dates above come from GitHub's repository/release API on retrieval [S8-S12]. “Actively maintained” is supported by recent commits for xterm, wterm, DomTerm and jQuery Terminal, but release cadence differs [S8-S11]. No GPL, LGPL, or AGPL candidate is recommended. DomTerm's `NOASSERTION` metadata is a license review flag, not evidence of copyleft [S10].

## Q2. Background, lock, and WebSockets

**Conclusion, HIGH confidence for suspension; MED for socket outcome:** iOS Safari can suspend background tabs and throttle timers. No supported browser API found that guarantees a live WebSocket through backgrounding or screen lock. Treat socket loss as normal and design session continuity above the browser connection [F6-F10].

- **F6, FACT:** WebKit says background pages have throttled timers and iOS tabs are “completely suspended when possible.” Its 2019 article does not specify a fixed delay or promise every socket closes [S13]. The Page Visibility API also treats screen lock as hidden [S14].
- **F7, FACT:** WebKit's WebSocket implementation suspends a channel with its page and explicitly fails it when the page enters the back-forward cache [S15]. This code does **not** prove every app switch or screen lock closes a socket. WebKit bug reports from 2021, 2022, and 2026 describe disconnects or failed reconnects after backgrounding, but differ by iOS version and trigger [S16-S18].
- **F8, FACT:** A service worker is event-limited and may be terminated when idle; WebKit says it terminates workers after a short grace period without clients [S19, S20]. A worker is therefore not a supported always-on socket host. Screen Wake Lock works in iOS home-screen apps since Safari 18.4, but it concerns an **active screen**, not execution after the app is backgrounded [S21, S22].
- **F9, PROBABLE:** Browser-side ping or SSH keepalive cannot guarantee continuity while JavaScript is suspended [S13, S19]. In localssh, the SSH client is WASM in the page; the relay destroys its TCP socket when the WebSocket closes. Therefore a new WebSocket cannot resume that same SSH transport, regardless of the Go client's 15-second keepalive interval [S23]. A durable session would need server-side SSH ownership or a reattachable remote multiplexer, followed by reconnect logic. This is an architecture inference from the current code.
- **F10, PROBABLE:** On foreground, detect stale or closed transport and report it; reconnect as a **new** SSH session only when appropriate. An Apple engineer recommended handling disconnects and reconnecting in the 2022 bug thread [S17]. This improves recovery, not persistence. A 2026 WebKit report describes a narrower `ws://` LAN-IP reconnection failure after backgrounding; another commenter says a hostname helped. That report is not a general iOS rule [S18].

### Conflicts and assumptions

- **C1:** The 2022 WebKit bug reporter said switching apps dropped WebSockets with `NSURLSession WebSocket` enabled and a settings change kept them open; an Apple engineer advised reconnection instead of promising continuity [S17, grades C/A, events 2022]. Resolve with controlled current-iOS Safari and home-screen tests across background durations and network changes. Do not recommend changing an experimental Safari setting.
- **C2:** xterm maintainers considered DOM/screen-reader rendering necessary for mobile selection, while 2023 iPhone users still could not select; a 2026 PR author says a patch works on an iPhone [S3-S5, grades A/C, events 2023-2026]. Resolve with the PR's review outcome and a localssh iPhone test including its CSS, gestures, mouse-reporting TUIs, and scrollback.
- **A1:** “Native” means Safari's actual text selection handles and Copy menu, not xterm's painted selection or a custom handle. This is the user's stated acceptance criterion.
- **A2:** A browser-only app cannot guarantee “until explicit disconnect” across iOS suspension, network loss, or process eviction [S13, S15, S19]. Confidence HIGH on the guarantee limit; exact socket survival time is LOW and device dependent.

### Gaps

- **G1:** No independent, current iPhone test compares wterm, DomTerm, hterm, and xterm 6 on the same SSH/TUI workload. A device matrix would resolve this.
- **G2:** No retrieved source gives a reliable iOS background timeout or socket survival rate. Instrument foreground/background time, close codes, relay TCP state, and iOS version.
- **G3:** No source establishes whether DomTerm's entire dependency tree has only permissive terms. Audit before considering it.

## Source log

All retrieved **2026-11-02**. Dates inside findings are publication, release, or event dates, not retrieval dates. GitHub issue comments are first-hand reports but remain grade C for general behavior. Vendor docs may favor their own product.

| ID | Claim or finding | Source | Retrieved | Reliability |
| --- | --- | --- | --- | --- |
| S1 | Current localssh DOM, screen reader, CSS and gesture setup | [Terminal.tsx](../../frontend/src/components/Terminal.tsx), [app.css](../../frontend/src/app.css) | 2026-11-02 | A, primary code |
| S2 | xterm renderer options and 6.0.0 release, 2025-12-22 | [xterm releases](https://github.com/xtermjs/xterm.js/releases/tag/6.0.0), [README](https://github.com/xtermjs/xterm.js/blob/master/README.md) | 2026-11-02 | A, upstream |
| S3 | Maintainer says DOM/screen-reader mode needed, mobile not priority, 2025-07-24 | [xterm issue 5377](https://github.com/xtermjs/xterm.js/issues/5377) | 2026-11-02 | A for maintainer position, not iOS outcome |
| S4 | iPhone failures in 2023; selectable-overlay workaround reported 2026-02-06 | [xterm issue 3727](https://github.com/xtermjs/xterm.js/issues/3727) | 2026-11-02 | C, user reports |
| S5 | Open native iOS selection PR, author reports iPhone test, 2026-05-29 | [xterm PR 5961](https://github.com/xtermjs/xterm.js/pull/5961) | 2026-11-02 | A for PR status/code, C for device claim |
| S6 | DOM selection and copy design; mounted history limits | [wterm README](https://github.com/vercel-labs/wterm/blob/main/packages/@wterm/dom/README.md) | 2026-11-02 | A for published design, self-interested outcome claim |
| S7 | iOS input bug and September 2026 fix status | [wterm issue 41](https://github.com/vercel-labs/wterm/issues/41) | 2026-11-02 | A for project status, C for original report |
| S8 | xterm stars, license, activity, latest release | [repo API](https://api.github.com/repos/xtermjs/xterm.js), [release API](https://api.github.com/repos/xtermjs/xterm.js/releases/latest) | 2026-11-02 | A, primary metadata |
| S9 | wterm stars, license, activity, latest release | [repo API](https://api.github.com/repos/vercel-labs/wterm), [release API](https://api.github.com/repos/vercel-labs/wterm/releases/latest) | 2026-11-02 | A, primary metadata |
| S10 | DomTerm stars, activity, release, copyright and BSD-style terms | [repo API](https://api.github.com/repos/PerBothner/DomTerm), [release API](https://api.github.com/repos/PerBothner/DomTerm/releases/latest), [COPYING](https://github.com/PerBothner/DomTerm/blob/master/COPYING) | 2026-11-02 | A for metadata and file; full license audit absent |
| S11 | jQuery Terminal stars, release, MIT, mobile/SSH limitations | [repo API](https://api.github.com/repos/jcubic/jquery.terminal), [release API](https://api.github.com/repos/jcubic/jquery.terminal/releases/latest), [README](https://github.com/jcubic/jquery.terminal/blob/master/README.md) | 2026-11-02 | A for metadata and project statement; self-interested |
| S12 | hterm GitHub mirror metadata, official source and stale npm packaging | [repo API](https://api.github.com/repos/chromium/hterm), [official libapps](https://chromium.googlesource.com/apps/libapps/+/HEAD/hterm/), [npm package](https://www.npmjs.com/package/hterm) | 2026-11-02 | A for project records |
| S13 | iOS tab suspension and timer throttling; article 2019-08-27 | [WebKit power guidance](https://webkit.org/blog/8970/how-web-content-can-affect-power-usage/) | 2026-11-02 | A, platform author; age limits detail |
| S14 | Screen lock hides a page | [MDN Page Visibility guidance](https://developer.mozilla.org/en-US/blog/using-the-page-visibility-api/) | 2026-11-02 | B, expert documentation |
| S15 | WebSocket suspend/resume and back-forward-cache failure | [WebKit source](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/websockets/WebSocket.cpp) | 2026-11-02 | A, primary code |
| S16 | iOS 15-era WebSocket after-sleep reports and disputed fixes | [WebKit bug 228296](https://bugs.webkit.org/show_bug.cgi?id=228296) | 2026-11-02 | C for reports; A for engineer comments |
| S17 | App-switch disconnect report, 2022; Apple engineer advises reconnect | [WebKit bug 245350](https://bugs.webkit.org/show_bug.cgi?id=245350) | 2026-11-02 | C for report; A for engineer advice |
| S18 | iOS 26.3 LAN-IP `ws://` reconnect report, 2026; hostname counter-report | [WebKit bug 308073](https://bugs.webkit.org/show_bug.cgi?id=308073) | 2026-11-02 | C, uncontrolled reports |
| S19 | WebKit worker lifetime, article 2018 | [Workers at Your Service](https://webkit.org/blog/8090/workers-at-your-service/) | 2026-11-02 | A, platform author; old article |
| S20 | Service workers can terminate when idle | [W3C Service Workers](https://www.w3.org/TR/service-workers/) | 2026-11-02 | A, standard |
| S21 | Home-screen Screen Wake Lock since Safari 18.4 | [WebKit Safari 18.4 features](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/) | 2026-11-02 | A, platform release note |
| S22 | Wake lock releases when document inactive | [MDN Screen Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API) | 2026-11-02 | B, expert documentation |
| S23 | localssh relay destroys TCP on WebSocket close; SSH keepalive every 15 seconds | [local-relay.ts](../../relay/src/local-relay.ts), [client.go](../../engine/sshclient/client.go), [main.go](../../engine/main.go) | 2026-11-02 | A, primary code |

## Ranked recommendation

1. **Keep xterm.js; prototype a read-only Select text view first.** It offers native browser text without changing SSH emulation. Verify actual iOS handles and Copy, Unicode, wraps, scrollback, and no sensitive text lingering after close [F1-F4].
2. **Trial direct xterm DOM selection behind a mobile mode.** Use PR 5961 as a design reference, but wait for review or test a scoped adaptation. Existing `screenReaderMode` is insufficient; local CSS and touch events must change [F1-F4].
3. **Prototype wterm only if the first two fail.** Its DOM selection architecture is promising, but iPhone behavior and terminal compatibility need independent proof [F5]. Do not replace xterm with jQuery Terminal or the stale hterm package [S11, S12].

For session continuity, do not promise a live browser WebSocket until explicit disconnect. If that promise is required, move SSH ownership to a server-side, reattachable session; otherwise explain disconnects and restore a new connection on foreground [F6-F10]. This research is a source review, not an on-device test. Release dates, stars, PR status, and iOS behavior may change after retrieval.
