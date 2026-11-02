# Termius mobile touch patterns: research for localssh

Retrieved 2026-11-02. Pattern research only; no Termius branding, visuals, or wholesale layout proposed.

## 1. Scope

Researching: how Termius (iOS/Android) makes SSH usable on small touch screens, to answer (a) which interaction patterns it uses for screen use, keys, gestures, sessions, hosts, settings, backgrounding, and accessibility, and (b) which transfer to a web app in iOS Safari; for the localssh phone redesign (`02-uiuxdesigner.md`) and Settings amendment (`08-uiuxdesigner-settings.md`); out of scope: desktop Termius, pricing, AI features beyond input placement, visual design.

## 2. Answers

### Q1 Screen use and chrome hiding. MED
Termius keeps one "keyboard add-on" row above the system keyboard and puts everything else in a side panel that overlays the keyboard on iPhone. It has shipped an auto-hide option for tabs and the add-on since 2020. The docs do not describe the full-screen layout, so the terminal's share of the screen is not documented.
- F-01 FACT: add-on "sits directly above the system keyboard and is always visible while typing"; shows the first three key groups. [S1, S3]
- F-02 FACT: side panel tabs are Extended keyboard, Snippets, Command history, Themes; "on iPhone the side panel sits on top of the system keyboard, on iPad it appears on the right side of the screen." [S1]
- F-03 PROBABLE: "Ability to auto-hide tabs and keyboard add-on in the terminal" (4.5.5, 2020-03-18). Single source; current default and trigger are not documented. [S3]
- F-04 FACT: with a hardware keyboard connected, "the on-screen keyboard and hotkeys bar hides automatically." [S1]
- F-05 FACT: a `hide-keyboard` button can be added to the add-on (7.6.0, 2026-08-10); landscape safe-area fix for the Dynamic Island (8.0.7, 2026-10-30). [S3, S5]
- F-06 FACT: iPhone app navigation uses a bottom tab bar with Vault, Connections, Profile (blog, 2025-02-25). [S6]

### Q2 Extra key row and customisation. HIGH
Keys come in groups of four. The user reorders groups and creates custom ones. The first three groups appear in the always-visible row; the rest sit in an emoji-keyboard-style extended panel.
- F-07 FACT: extended keyboard covers Ctrl, Esc, Tab, modifiers, arrows, function keys, symbols; "Keys are organized into groups of four which can be reordered or customized." [S1, S2]
- F-08 FACT: "The order of the groups matters as the first three groups appear in the" add-on; reorder by drag in Side panel > Customize; custom groups supported. [S1]
- F-09 FACT: extended panel modelled on "the emoji keyboard" and also hosts snippets, history, customisation (2024-07-19). [S2]
- F-10 FACT: Shift+Tab added to the extra keyboard "enabling actions for Claude Code and other AI tools" (6.3.0, 2025-08-25); the user can bind volume buttons to an action (6.3.1; Settings > Volume buttons). [S1, S3]
- F-11 FACT: the user can insert the host's saved password from the extended keyboard. [S1]

### Q3 Gestures. HIGH for documented ones, LOW for scroll
- F-12 FACT: arrows: "Long-press the terminal screen and drag in any direction"; or "Hold the Space key and slide"; holding repeats; "three speeds gears", with speed rising as the finger moves further. [S1, S2, S3 5.0.0/5.7.0/5.8.4]
- F-13 FACT: "Double-tap the terminal screen to send a Tab keystroke." [S1]
- F-14 FACT: "Pinch with two fingers to zoom in or out on the terminal screen to adjust the text size." [S1]
- F-15 FACT: select: "Press and hold the word, then release. Selection handles appear"; Copy from the iOS context menu. Paste: press-hold-release then `Paste`, or "Tap with three fingers". [S1, S3 5.7.0]
- F-16 PROBABLE: Termius tells long-press-then-release (select) apart from long-press-then-drag (arrows) by finger movement after the hold. Inferred from F-12 and F-15 together; Termius does not document the disambiguation rule.
- F-17 PROBABLE: one-finger drag scrolls output. No page documents the scroll gesture. Indirect evidence: "Improved scrolling experience" (7.4.0) and Android "Fixed an issue with arrow gestures triggered while scrolling slowly" (7.7.2), which shows the two gestures conflicted in the field. [S3, S7]
- F-18 PROBABLE: shake the device to emulate Tab/arrows/PgUp/PgDn/Home/End (App Store text); the current docs do not mention it, so it may be legacy. [S4]
- F-19 FACT: cursor speed for gestures is a setting (Profile > Settings > Cursor speed). [S1]
- F-20 FACT: OSC 52 copy support (7.4.0); paste image/file uploads to `/tmp` and inserts the path (7.5.0). [S1, S3]

### Q4 Session/tab switching. LOW
iOS supports "multi-tab interface and split-view" [S4], and SFTP tabs sit alongside terminal tabs (6.0.0) [S3, S6]. No retrieved source describes how a user switches sessions on iPhone (tab strip vs list vs swipe). SUSPECTED: the Connections tab in the bottom bar [S6] lists open sessions; unverified.

### Q5 Host list and connect flow. MED
- F-21 FACT: a host is a named record (address, user, auth, labels, tags); create with `+` on the Hosts screen, tap a host to connect; Termius auto-saves edits; vaults sync to mobile after login. [S13, S14]
- F-21b PROBABLE: a 2024 hands-on review describes saved hosts that "appear in a list of hosts, and then they're just a tap away", plus a sidebar of shortcut keys, snippets, and history. Seen only through a search snippet; the page returned 403. [S15]
- F-22 FACT: per-host startup snippet (e.g. launch `tmux`) runs on connect. [S8]
- F-23 FACT: Mosh is a per-host toggle (`Use Mosh`) on mobile. [S13]
- F-23b FACT: 8.0.2 moved terminal rendering to libghostty, and 8.0.6 added iPhone Duo support (third-party report, 2026-10-23, consistent with S3). [S16]

### Q6 Settings organisation. MED
Two levels: per-host appearance in the terminal side panel, and app-wide input behaviour in Profile > Settings.
- F-24 FACT: Themes tab changes "theme, font, and font size — for the current host"; changes persist for that host's future sessions. [S1]
- F-25 FACT: Profile > Settings holds keyboard behaviour (CJK input, Option as Meta, Remap Caps Lock), Cursor speed, Volume buttons, Hide AI widget, Live Activities. [S1, S9]
- F-26 GAP: no retrieved Termius doc names an SSH keep-alive interval setting.

### Q7 iOS backgrounding. HIGH on the limit, MED on mechanism
- F-27 FACT: "Recent versions stop background activity almost immediately, usually within 20 to 30 seconds. Older versions could allow it for 2 to 3 minutes." [S8]
- F-28 FACT: mitigations Termius documents: enable location tracking ("background connections are less likely to be interrupted"), iPad Split View, `tmux`/`screen` (which do not help port forwarding), and Mosh for network changes. [S8, S13, S9]
- F-29 FACT: Live Activity shows active connections (5.6.1) and port forwards (5.8.0); the blog advises "enable Live Activities in Termius settings" (2026-05-11). [S3, S9]
- F-30 FACT: the app shows a PIN screen each time it goes to background (6.3.3) and blurs its app-switcher preview (2020). [S3, S7-dump]
- F-31 FACT (Android): sessions stop when battery optimisation is on; fix is "unrestricted" background usage. [S10]

### Q8 Accessibility. LOW
- F-32 FACT: App Store: "The developer has not yet indicated which accessibility features this app supports." [S4]
- F-33 FACT: "Support for Full Keyboard Access" (4.6.8, 2020). No changelog entry mentions VoiceOver, Dynamic Type, or reduced motion. [S3]
- The sources do not show whether the gesture-only actions (double-tap Tab, three-finger paste) have visible equivalents beyond the key row. Double-tap is also VoiceOver's activate gesture, so the two would clash; that is inference, not tested.

## 3. Conflicts

- C-01 Background window: support docs say 20-30 s now and 2-3 min before [S8]; an App Store review says "no more than 3 minutes" [S4, C-grade, undated]. Weight the dated official doc. Testing current 8.0.7 would settle it.
- C-02 Location as keep-alive: docs present location as reducing interruptions [S8]; a third-party summary of a Termius forum reply says Termius prefers not to rely on location and uses Live Activities [S11, not opened, D until verified]. Resolve by reading the forum thread directly.
- C-03 With localssh spec: Termius maps long-press+drag to arrows and double-tap to Tab. localssh T-01/T-02 forbid hidden key gestures and reserve long press for native selection (T-03). Termius's own Android fix (F-17) shows the scroll-vs-arrow conflict the spec is avoiding. Neither source proves which is better for localssh users.
- C-04 With localssh L-06 ("no auto-hide"): Termius offers auto-hide of tabs/add-on as an option (F-03) but keeps the add-on visible while typing (F-01). That is compatible with L-06 if auto-hide stays opt-in.

## 4. Transferable patterns for localssh in iOS Safari, ranked by value

Rank | Pattern | Web feasible? | Fit with localssh spec
--- | --- | --- | ---
1 | Expect session loss on background; make return fast: detect resume (`visibilitychange`, `pageshow` with `persisted`), mark the tab Disconnected, offer one-tap reconnect to the same target, and recommend a `tmux` startup command (F-22, F-27, F-28) | YES. Safari can drop WebSockets on app switch, sometimes without `onclose` [S12, C-grade]; localssh runs SSH in the page (`engine/sshclient`), so no background keep-alive is possible | Extends S-04/S-10; the existing 15 s keepalive ×3 detects loss
2 | Key groups with user-reordered priority: a fixed visible row from the top groups, the rest in an overflow panel (F-07, F-08) | YES (DOM, localStorage) | Refines L-08; a Settings item in `08`
3 | Shift+Tab, Esc, Ctrl in the visible row by default for TUI/agent use (F-10) | YES | L-08 already has Esc/Tab/Ctrl; add Shift+Tab
4 | Explicit hide-keyboard key in the row (F-05) | YES (`blur()` on the input) | Matches L-02 fallback and S-06
5 | Per-host font and font size remembered for that host (F-24) | YES | Settings scope question for `08`
6 | Pinch to change font size, then refit PTY (F-14) | PARTIAL: needs `touch-action` control and Safari `gesturechange`/two-pointer handling without fighting page zoom; untested | Optional; must not conflict with Safari zoom accessibility
7 | Hardware keyboard detected: hide the on-screen row (F-04) | PARTIAL: no direct API; infer from `visualViewport` not shrinking on focus. Heuristic, unreliable | Low priority
8 | Space-bar slide or long-press-drag for arrows with speed gears (F-12) | PARTIAL: no access to the iOS keyboard's space bar from a web page; long-press-drag on output is possible but collides with T-01/T-03 | Not recommended under current spec (C-03); arrows stay as keys
9 | OSC 52 copy from remote programs (F-20) | YES (xterm addon); clipboard write needs a user gesture/secure context | Complements T-07 fallback
10 | Paste image as `/tmp` upload + insert path (F-20) | YES via existing SFTP/Files path | Feature, not a touch pattern; defer

Native-only, not transferable: background execution / Live Activities (F-29), location-based background extension (F-28), volume-button bindings (F-10), shake gesture (F-18), app-switcher blur and PIN-on-background (F-30), Android battery exemption (F-31), access to the system space-bar trackpad (F-12), Mosh/UDP (F-23; browsers have no raw UDP).

## 5. Gaps

- G-01 How iPhone users switch terminal sessions in Termius: would need a hands-on test of 8.0.7.
- G-02 Scroll gesture spec and how long-press select/arrow are disambiguated: undocumented; would need a device test.
- G-03 Keep-alive interval setting: not found in docs dump; check host settings in-app.
- G-04 Default key groups and order: not listed in docs; would need in-app inspection.
- G-05 Accessibility (VoiceOver labels, Dynamic Type): undeclared on the App Store; would need a VoiceOver audit.

## 6. Source log

ID | Claim used for | Source | Retrieved | Grade
--- | --- | --- | --- | ---
S1 | Mobile terminal: gestures, keys, side panel, settings, themes; also Connecting to a server, Mosh, Sync to mobile pages | https://docs.termius.com/terminal/mobile-terminal ; full text https://docs.termius.com/llms-full.txt | 2026-11-02 | A (vendor primary doc, undated)
S2 | 2024 iOS touch terminal redesign rationale | https://termius.com/blog/new-touch-terminal-on-ios (2024-07-19) | 2026-11-02 | A for what Termius ships; vendor
S3 | iOS changelog entries cited by version | https://docs.termius.com/changelog/ios (newest 8.0.7, 2026-10-30) | 2026-11-02 | A
S4 | App Store description, 8.0.7 notes, accessibility label, user review | https://apps.apple.com/us/app/termius-ssh-mosh-client/id549039908 | 2026-11-02 | A (listing); review C
S5 | 8.0.7 safe-area fix | same as S3/S4 | 2026-11-02 | A
S6 | iPhone bottom tab bar, SFTP tabs | https://www.termius.com/blog/termius-for-ios-new-navigation-and-sftp (2025-02-25) | 2026-11-02 | A, vendor
S7 | Android changelog 7.7.2 arrow/scroll fix; legacy changelog lines in S1 dump | https://www.apkmirror.com/apk/termius-corporation/termius-ssh-telnet-client/termius-modern-ssh-client-7-7-2-release/ ; S1 dump line ~10841 | 2026-11-02 | B (mirror of vendor notes; dates inconsistent)
S8 | Background limits and mitigations | https://docs.termius.com/help-center/faq/how-can-i-keep-termius-sessions-alive-in-the-background-on-ios-ipados | 2026-11-02 | A, undated
S9 | AI-on-mobile tips: Live Activities, tmux, Mosh, key bar | https://termius.com/blog/8-tips-for-using-ai-agents-on-mobile-in-termius (2026-05-11) | 2026-11-02 | A, vendor marketing
S10 | Android background fix | https://docs.termius.com/help-center/troubleshooting/port-forwarding-or-ssh-connections-stop-working-when-switching-apps-on-android | 2026-11-02 | A
S11 | Forum reply on Live Activities vs location (via search summary only) | not opened; Termius forum | 2026-11-02 | D until read
S12 | Safari drops WebSocket on background, bfcache `pageshow` | https://github.com/flarum/framework/issues/4588 ; https://developer.apple.com/forums/thread/696310 ; https://www.github.com/socketio/socket.io/issues/2924 | 2026-11-02 | C (community reports; corroborate on device)

S13 | Connecting to a server; Mosh on mobile | https://docs.termius.com/organize-and-connect-to-hosts/connecting-to-a-server (text read via llms-full.txt) | 2026-11-02 | A
S14 | Hosts sync to mobile | https://docs.termius.com/getting-started/sync-to-mobile (search summary only) | 2026-11-02 | A source, unverified read
S15 | 2024 hands-on review (Kurt Liebezeit) | https://www.podfeet.com/blog/2024/08/termius/ (HTTP 403; search snippet only) | 2026-11-02 | B source, UNVERIFIED quote
S16 | 8.0.x release coverage | https://www.ithinkdiff.com/?p=351477 (2026-10-23) | 2026-11-02 | B

Unverified items: F-03 (auto-hide is current?), F-16, F-17, F-18, Q4 SUSPECTED, F-21b, S11, S14.

Unreachable: https://support.termius.com/hc/en-us/articles/900006226306 (HTTP 403); https://termius.com/changelog/ios-changelog (404).

## 7. Limitations

- Termius ships often (8.0.6 to 8.0.7 in one week); gesture and keyboard details may change after 2026-11-02.
- Docs pages carry no last-updated date. The S1 text dump mixes current docs with old changelogs, so I cite individual lines only with their version and date.
- I did not test the app hands-on; all behaviour comes from vendor text. Vendor docs describe intent, not measured usability.
- Safari background behaviour (S12) comes from community reports across iOS versions; verify it on the target iOS version before designing reconnect UX around it.
