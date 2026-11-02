# Mobile UI revision: Termius patterns, Settings, transfer resume

Designing: phone session chrome, key bar, Settings, and Files transfer states for browser SSH users working in a shell on iPhone Safari, vibe calm and precise, on phone first (desktop unchanged), design system `DESIGN.md` (locked; delta below). Mode: Operate. Redesign mode: targeted refinement of `02-uiuxdesigner.md` (02) and `08-uiuxdesigner-settings.md` (08).

Dials unchanged from 02 D-01 to D-03: VARIANCE 2, DENSITY 8, MOTION 1. Settings stays DENSITY 6 (08). The key bar editor is a form, DENSITY 6.

Inputs read: 02, 05 Decisions (lead: long press and `Select text` open a read-only snapshot view), 08, 09 section 4, T5 report, `App.tsx`, `KeyBar.tsx`, `terminalKeys.ts`, `Terminal.tsx`, `FilePanel.tsx`, `app.css`. Architecture amendment 11 (download pause and resume) does not exist yet; transfer states below depend on it and mark the dependencies.

Material, real: current key list and order (`terminalKeys.ts:42`), Keyboard toggle with `Show keyboard`/`Hide keyboard` (`KeyBar.tsx:45`), two-finger scrollback on the terminal (`Terminal.tsx:278-393`), `touch-action: none` on `.terminal-host` (`app.css:614`), Files progress line `Downloading <name>: N%` with Cancel (`FilePanel.tsx:635`), close-during-transfer confirmation (`FilePanel.tsx:505`), vault lock state for saved hosts (`SavedHosts.tsx:28`). Absent: device captures, user testing, the 11 resume contract, measured Safari background behavior on the target iOS version.

Idea (unchanged from 02, extended): the active SSH target is the fixed point. New: when that target's connection drops, the key bar slot, where the thumb already is, becomes the recovery control for that same target. Competitor test: any client can show a reconnect button; the localssh move is that recovery appears exactly where input was, so the user never hunts for it after returning from another app.

## 1. Pattern decisions (09 section 4, ranks 1 to 7)

Interaction patterns only. No Termius naming, visuals, iconography, or layout is copied.

ID | RANK | PATTERN | DECISION | REASON | CONFIDENCE
--- | --- | --- | --- | --- | ---
P-1 | 1 | Fast return after background loss, one-tap reconnect, tmux advice | ADAPT | Adopt the return detection and one-tap Reconnect to the same target. Adapt: localssh first tries the v2 resume (architecture R1/D1), so the user sees `Resuming` before any `Disconnected`. Reject Termius's per-host startup command for now: it adds a saved-host field and an auto-typed command, which is feature scope, not chrome. tmux advice goes in the recovery row text and Help instead. | HIGH for the need (09 F-27: iOS stops background work within 20 to 30 s); MED for the flow (no device test)
P-2 | 2 | User-ordered keys; visible row from the top of the order, rest in an overflow panel | ADAPT | Adopt priority order plus overflow. Adapt: no groups of four; the row shows as many keys as fit the current width, then a fixed `More keys` control. This replaces the horizontal scroll, which hides keys with no visible cue. Custom keys with arbitrary byte sequences are rejected for this phase (scope; overlaps snippets). | MED: 09 F-07/F-08 HIGH as fact; fit for localssh users unvalidated
P-3 | 3 | Shift+Tab, Esc, Ctrl in the default visible row | ADOPT | TUI and coding-agent prompts use Shift+Tab (09 F-10); Esc and Ctrl were already early in 02 L-08. Add `⇧tab` (sends `ESC [ Z`). Reorder defaults, see K-02. | MED
P-4 | 4 | Hide-keyboard key in the row | ADOPT, already built | `KeyBar.tsx` Keyboard toggle already shows/hides the keyboard with state in its name. Keep it first and exempt it from editing. Answers 05 question: no extra control. | HIGH
P-5 | 5 | Per-host font and size | ADAPT | Adopt per-host terminal appearance. Adapt: only for saved hosts, stored in the saved-host record inside the vault, so host names never land in plain `localStorage` beside the settings. Unsaved targets use the all-hosts settings. | MED; vault schema change needs the planner
P-6 | 6 | Pinch to change font size | REJECT the gesture; ADAPT the intent | Two-finger drag already scrolls output (`Terminal.tsx:382-393`); pinch versus two-finger pan has no tested disambiguation and Termius's own field fix (09 F-17) shows these gestures collide. WCAG 2.2 SC 2.5.1 requires a single-pointer alternative for multipoint gestures anyway. Provide `Text smaller` and `Text larger` keys (in More keys by default) and the Settings size field. Do not add any new pinch handler, so no further Safari zoom behavior is taken from the user. | HIGH for rejecting; MED for the keys
P-7 | 7 | Hide the key row when a hardware keyboard is attached | REJECT | No web API reports a hardware keyboard; inferring it from `visualViewport` misfires, and a wrong guess hides the only Esc/Ctrl/arrows a touch user has. Keep 02 L-06. Revisit only as an explicit user choice in Settings if iPad users ask. | MED

Ranks 8 to 10 are unchanged by this step: arrows stay keys (8, rejected in 09 under C-03), OSC 52 and paste-upload are features outside this design (9, 10). Termius double-tap to send Tab (09 F-13) is also rejected: double-tap is VoiceOver's activate gesture.

## 2. Delta against 02

ID | 02 ITEM | CHANGE
--- | --- | ---
R-01 | L-08 key order and horizontal scroll | Replaced by K-01 to K-06: ordered list, fit-to-width row, fixed Keyboard first and `More keys` last, no horizontal scroll.
R-02 | L-07 landscape | Add a short-height rule (L-10): when the visual viewport is shorter than 400 CSS px and wider than 600 CSS px (landscape with keyboard), the session row merges into the key bar row. Nothing hides; target and Actions stay visible.
R-03 | L-06 no auto-hide | Unchanged. P-7 and L-10 keep every control visible.
R-04 | S-04 disconnected tab | Extended by S-13 to S-19 (resume, recovery row, reconnect). The key bar slot shows the recovery row while the active tab is disconnected.
R-05 | S-06 keyboard states | Add S-20 `More keys` open: the panel takes the keyboard's place.
R-06 | F-05, T-03, T-05, S-07 | Already superseded by 05 lead decision (read-only `Select text` view). Add: `Select text` also works on a disconnected tab, so the last output of a closed session can be copied.
R-07 | F-04 Actions contents | Per 08: Files, Disconnect, Clipboard, Settings, Help, About.
R-08 | V-04 | Extended: can users find keys in `More keys`, and does the default order suit them.

## 3. Delta against 08

ID | 08 ITEM | CHANGE
--- | --- | ---
R-09 | Sections Terminal, Session | Sections become Terminal, Key bar, Session. Key bar appears only on devices that show the key bar (coarse pointer), since its settings do nothing elsewhere.
R-10 | Terminal section | Add `Apply to` control at the top of the section (P-5). Fields edit either the all-hosts settings or the active saved host's own settings.
R-11 | S-09 preview | Unchanged; preview uses the values for the chosen scope.
R-12 | S-05 apply on change | Also governs Key bar edits: each move, add, remove applies at once and saves; no Save button.
R-13 | Session section | Unchanged copy. The tmux sentence there now pairs with the recovery row hint (strings section).
R-14 | Save status | Same single polite live region serves all three sections.

## 4. Wireframes

Roles and order, not pixel art. Widths: 320px and 390px portrait; 844px landscape. Key cell 44px minimum, 6px gap, 8px side padding plus safe-area insets (current `.key-bar`).

### 4.1 Phone portrait, keyboard open, 390px

```text
top safe area
| [Connected  mark@pi.lan:22  v]                    [Actions] |  44px, 60px if target wraps
|                                                [Select text]|  existing floating control
| terminal output                                             |
| mark@pi.lan:~$ _                                            |
| [kbd v] [ctrl] [esc] [tab] [⇧tab] [↑]           [More keys] |  key bar, fit-to-width
| iOS keyboard                                                |
```

At 320px the same row holds Keyboard, four keys, `More keys`: `[kbd v] [ctrl] [esc] [tab] [⇧tab] [More]`. The count comes from measuring the row, not from a breakpoint. `More keys` always sits at the right end; it never scrolls off.

### 4.2 More keys open (portrait)

```text
| [Connected  mark@pi.lan:22  v]                    [Actions] |
| terminal output, refit once to the shorter area             |
| mark@pi.lan:~$ _                                            |
| [kbd]   [ctrl] [esc] [tab] [⇧tab] [↑]        [More keys ^]  |  pressed state
| [↓]  [⏎]  [⌫]  [alt] [^C] [←]  [→]                          |  panel replaces
| [^D] [^Z] [home] [end] [|] [/] [~]                          |  the iOS keyboard
| [-]  [A-] [A+]                                              |  4 rows max,
| bottom safe area                                            |  scrolls inside
```

Opening the panel dismisses the system keyboard and docks the panel where the keyboard was, above the bottom safe area. Keys in the panel send and leave the panel open. `Keyboard` closes the panel and raises the keyboard; `More keys` closes the panel and restores the keyboard if it was up when the panel opened. Panel height: up to four key rows, capped at 40 percent of the visual viewport; extra keys scroll inside the panel.

### 4.3 Landscape, keyboard open, short height (L-10)

```text
left inset | [mark@pi.lan:22 v] [kbd v][ctrl][esc][tab][⇧tab][↑][↓][⏎][⌫][alt] [More][Actions] | right inset
           | terminal output                                                                      |
           | mark@pi.lan:~$ _                                                                     |
           | iOS keyboard                                                                         |
```

One combined row saves one 44px row, about two terminal rows at the default 14px/1.15. The target keeps its own button and opens `Open terminals`. It shows the full `user@host:port`; when the target is wider than 35 percent of the row, it truncates in the middle, keeping user and host, and the switcher and the button's accessible name carry the full text. This is the only place the target may truncate (DESIGN.md exception, see M-05). Status text (`Connected`) moves into the button's accessible name and the switcher; the visible row shows `Resuming` or `Disconnected` text when not connected, never color alone. Where the row sits: at the top of the visual viewport, so it stays clear of the keyboard and the prompt sits at the bottom of the terminal.

Landscape without the keyboard, or taller than 400px: the 02 layout (session row on top, key bar at the bottom).

### 4.4 Recovery row: active tab disconnected (S-15)

```text
| [Disconnected  mark@pi.lan:22  v]                 [Actions] |
|                                                [Select text]|
| frozen terminal output, still scrollable                    |
| mark@pi.lan:~$ tail -f app.log                              |
|-------------------------------------------------------------|
| The connection closed while localssh was in the background. |  15/22
| To keep commands running while you are away, start them in  |  13/18 muted
| tmux or screen.                                             |
|                          [Close terminal]     [Reconnect]   |  44px, primary right
| bottom safe area                                            |
```

The row replaces the key bar in the same slot. No keyboard: input has nowhere to go. The tmux line shows only when the cause is background loss. For other causes the first line uses the cause text (strings). At 320px the buttons stay side by side (each at least 44px tall, text not clipped); if they do not fit they stack, `Reconnect` first.

Reconnecting (S-16): the row shows `Connecting to <host>...` with the buttons replaced by `Cancel`.

### 4.5 Settings sheet (phone), extends 08

```text
| Settings                                         [ Close ] |  sticky
| Terminal                                                   |
|   Apply to                                                 |
|   [ All hosts                                         v ]  |  options: All hosts,
|   <scope line>                              13/18 muted    |  This host: <name>
|   Font family   [ IBM Plex Mono                       v ]  |
|   Font size     [ 14 px                               v ]  |
|   Line height   [ 1.15                                v ]  |
|   Color scheme  [ <theme>                             v ]  |
|   [Use all-hosts settings for this host]                   |  only with an override
|   | mark@pi.lan:~$ ls        preview                    |   |
| Key bar                                                    |  coarse pointer only
|   Choose which keys show above the keyboard and in what    |
|   order.                                                   |
|   [ Edit key bar                                      > ]  |  44px row button
| Session                                                    |
|   (08 keep-alive control, cap line, risk text unchanged)   |
|   <save status>                              live region   |
```

Labels sit above fields as in 08 (the drawing compresses them). Scope line states (P-5):

ID | CONDITION | `Apply to` | SCOPE LINE
--- | --- | --- | ---
H-01 | No session, or active target not a saved host | disabled, `All hosts` | `To give a host its own terminal settings, save it in Saved hosts.`
H-02 | Saved host, vault locked | disabled, `All hosts` | `Unlock saved hosts to use settings for this host.`
H-03 | Saved host, no override | enabled, `All hosts` | none
H-04 | Saved host, override exists | enabled, `This host: <name>` selected on open | `This host uses its own terminal settings.`
H-05 | User switches to `This host` with no override | override created from the current all-hosts values | `Changes here apply only to <name>.`

`Use all-hosts settings for this host` removes the override immediately and selects `All hosts`; status `This host now uses the settings for all hosts.` No confirmation: four preference values, restorable by hand, no data loss outside them.

### 4.6 Key bar editor (sub-view of Settings)

```text
| [< Settings]          Key bar                      [ Close ] |  sticky
| The row shows keys in this order, as many as fit. The rest  |
| open from More keys.                                        |
|                                                             |
| Keyboard             always first                           |
| ctrl                          [ ^ ] [ v ] [ Remove ]        |
| esc                           [ ^ ] [ v ] [ Remove ]        |
| tab                           [ ^ ] [ v ] [ Remove ]        |
| ⇧tab  Shift Tab               [ ^ ] [ v ] [ Remove ]        |
| --- Below this line: in More keys on this screen ---       |  computed now
| ↑     Up arrow                [ ^ ] [ v ] [ Remove ]        |
| ...                                                         |
| A+    Text larger             [ ^ ] [ v ] [ Remove ]        |
|                                                             |
| Not in key bar                                              |
| ^Z    Control Z, suspend                         [ Add ]    |  appended to the end
|                                                             |
| [ Reset key bar ]                                           |
| <save status>                                 live region   |
```

Each row: key face, spoken name when the face is a glyph, then `Move up`, `Move down`, `Remove` icon buttons, 44px each (132px; leaves 156px for the label at 320px). No drag reordering in this phase (WCAG 2.2 SC 2.5.7 needs a non-drag path; buttons are that path, and drag can follow later). `Keyboard` and `More keys` are not in the list; they are fixed. The divider position is measured from the current row width and moves when the device rotates; it is guidance, not a setting. `Reset key bar` applies the defaults immediately; status `Key bar reset to the default keys.`

Desktop does not show this sub-view (no key bar on fine pointers).

### 4.7 Files transfer states (phone, Files replaces terminal)

```text
| Files  [Upload] [Refresh] ...                  [Close files] |
| ~/backups                                          |
|-------------------------------------------------------------|
| <transfer block, one of X-01 to X-08>                       |
|-------------------------------------------------------------|
| file list                                                   |
```

Transfer block per state:

```text
X-01 Downloading
| Downloading backup.tar.gz: 42%                    [Cancel] |
| Keep localssh open until this finishes. If you switch apps, |  13/18 muted, touch only
| the download pauses and continues when you come back.       |

X-02 Paused in background   (rendered on hide; seen in the app switcher and on return)
| Paused: backup.tar.gz at 42%                      [Cancel] |
| Downloads pause while localssh is in the background.       |

X-03 Resuming
| Resuming backup.tar.gz from 42%...                [Cancel] |

X-04 Resumed  -> returns to X-01 text with live percent; announces "Download resumed."

X-05 Could not resume, can retry from the offset
| Could not resume backup.tar.gz.                            |  role=alert
| The server did not answer in time.                         |
|                         [Cancel]       [Resume download]   |

X-06 Could not resume, file changed
| Could not resume backup.tar.gz.                            |
| It changed on the server after the download started.       |
|                         [Cancel]                 [Retry]   |  Retry starts over

X-07 Session ended during the download  (shown after Reconnect, when Files opens again)
| backup.tar.gz stopped at 42% when the connection closed.   |
|                  [Dismiss]   [Retry]   [Resume download]   |  Resume only if 11 keeps
                                                               the partial bytes

X-08 Done -> existing toast "Downloaded backup.tar.gz." and download link
```

`Resume download` continues from the saved byte offset. `Retry` downloads the whole file again. Each failure state shows only the actions that can work. The primary action sits at the right, nearest the thumb. `Cancel` in X-05 and X-06 discards the partial bytes; no confirmation, because the remote file is untouched and `Retry` stays one tap away until Files closes. The 505 close-during-transfer confirmation also covers X-02, X-03, and X-05 (an unfinished download).

While the session is in S-13 Resuming, Files shows X-03 or X-02 and its controls other than Cancel are disabled. If the session ends (S-15), Files cannot stay open (it needs a live handle, `App.tsx` FilePanel guard), so the recovery row adds a line: `Download of <name> stopped at <N>%.` and after Reconnect, opening Files shows X-07.

## 5. Updated state list

02 S-01 to S-12 remain. New and revised:

ID | STATE | TRIGGER | UI
--- | --- | --- | ---
S-04 (rev) | Disconnected tab | Session closed for any reason | Switcher entry `Unplug` + `Disconnected` (built). Active tab: recovery row replaces key bar (S-15).
S-13 | Resuming | Page visible again (`visibilitychange` visible or `pageshow`) and v2 resume in progress | Session row status `Resuming`; key bar keys disabled (`aria-disabled`), Keyboard toggle hidden; terminal output stays visible. No input is buffered. Timeout set by 11, then S-14 or S-15.
S-14 | Resumed | Resume accepted, byte offset continuous | Status returns to `Connected`; one polite announcement `Back in session.` No toast.
S-15 | Session ended | Resume refused or expired, v1 relay, keep-alive Off, or loss while visible | Recovery row with cause text, `Close terminal`, `Reconnect`. `Select text` stays available.
S-16 | Reconnecting | `Reconnect` tapped and credentials available | Recovery row shows `Connecting to <host>...` and `Cancel`. Host-key check runs as now; a changed key still blocks with the existing danger prompt.
S-17 | Reconnect needs sign-in | Password auth not stored, or vault locked | Connect view opens with host, user, port filled and focus on the first empty credential field. Success replaces the disconnected tab in place; going back leaves it in S-15.
S-18 | Reconnected | New session open | Key bar returns; earlier output stays above a local marker line `[localssh] New connection. Output above is from the closed session.` (faint), so old and new output are distinguishable.
S-19 | Reconnect failed | Connect error | Existing connection error text in the recovery row, buttons `Close terminal` and `Reconnect` (retry).
S-20 | More keys open | `More keys` pressed | Panel in the keyboard's place; `More keys` pressed state; Escape (hardware keyboard), `More keys`, or `Keyboard` closes it. Closes on session change, Files, Settings, or S-13.
S-21 | Short landscape | Visual viewport under 400px tall and over 600px wide | Combined row (4.3).
S-22 | Text size at limit | `Text smaller` at 8px or `Text larger` at 32px | That key is `aria-disabled`; announcement names the limit.
K-01..K-06 | Key bar editor | see 4.6 | First row Move up and last row Move down are `aria-disabled` (stay focusable). Empty list: row shows Keyboard and `More keys` only; More panel text `No keys. Add keys in Settings, Key bar.`
H-01..H-05 | Per-host scope | see 4.5 |
X-01..X-08 | Download transfer | see 4.7 |

Uploads keep current behavior in this step; whether an interrupted upload can resume is for 11. If 11 adds it, reuse X-02 to X-07 with `Upload` wording.

K-02 default order (all present; the row shows the first ones that fit):
`ctrl, esc, tab, ⇧tab, ↑, ↓, ⏎, ⌫, alt, ^C, ←, →, ^D, ^Z, home, end, |, /, ~, -, A-, A+`.
Tradeoff: at 390px `↓`, `⏎`, and `^C` fall into More keys. With the keyboard up, iOS Return and Delete cover `⏎` and `⌫`, and `ctrl` then `c` covers `^C`; with the keyboard down, history recall (`↑` then `⏎`) needs one trip to More keys. The current order (`terminalKeys.ts:36` comment) favored keyboard-down recall; the Termius evidence favors TUI keys. MED, validate with users (V-07).

## 6. Strings (draft for writer review)

Key bar:
- `More keys` (button; `aria-expanded`). Panel group label `More keys`.
- `⇧tab`, spoken `Shift Tab`. `A-` spoken `Text smaller`; `A+` spoken `Text larger`.
- Text size announcement: `Text size <N> px.`; at limits `Text size 8 px, the smallest.` / `Text size 32 px, the largest.`
- Empty panel: `No keys. Add keys in Settings, Key bar.`

Settings:
- Section `Key bar`; intro `Choose which keys show above the keyboard and in what order.`; button `Edit key bar`.
- Editor title `Key bar`; back `Settings`; intro `The row shows keys in this order, as many as fit. The rest open from More keys.`; fixed note `always first`; divider `Below this line: in More keys on this screen`; group `Not in key bar`.
- Row buttons, accessible names: `Move <spoken name> up`, `Move <spoken name> down`, `Remove <spoken name> from the key bar`, `Add <spoken name> to the key bar`.
- Move status: `<spoken name> moved to position <n> of <total>.` Add/remove status: `<spoken name> added.` / `<spoken name> removed.`
- `Reset key bar`; status `Key bar reset to the default keys.`
- `Apply to`; options `All hosts`, `This host: <saved host name>`. Scope lines H-01 to H-05 as in 4.5. Button `Use all-hosts settings for this host`; status `This host now uses the settings for all hosts.`

Session return and recovery:
- Status text: `Resuming`, `Connected`, `Disconnected` (existing), `Connecting to <host>...` (existing).
- Announcements: `Back in session.`; `Terminal for <target> disconnected.`
- Recovery cause lines: background `The connection closed while localssh was in the background.`; network `The connection to the server was lost.`; server `The server closed the connection.`; user `You disconnected this terminal.`
- tmux hint (background cause only): `To keep commands running while you are away, start them in tmux or screen.`
- Buttons `Reconnect`, `Close terminal`, `Cancel`.
- Marker line: `[localssh] New connection. Output above is from the closed session.`
- Transfer line in recovery row: `Download of <name> stopped at <N>%.`

Transfer:
- `Downloading <name>: <N>%` (existing).
- Hint, touch only: `Keep localssh open until this finishes. If you switch apps, the download pauses and continues when you come back.`
- `Paused: <name> at <N>%`; `Downloads pause while localssh is in the background.`
- `Resuming <name> from <N>%...`; announcement `Download resumed.`
- `Could not resume <name>.` with reason `The server did not answer in time.` or `It changed on the server after the download started.`
- `<name> stopped at <N>% when the connection closed.`
- Buttons `Resume download`, `Retry`, `Cancel`, `Dismiss`.
- Done: `Downloaded <name>.` (existing).

The hint promises pause and continue, not background completion. iOS suspends the page; the download finishes after return, and only if 11 can resume. If 11 cannot guarantee resume across page eviction, the hint must say so (Q-04).

## 7. Accessibility notes

- Single-pointer alternatives: no new multipoint or path gesture. Font size: Settings field and `Text smaller`/`Text larger` keys (SC 2.5.1). Reorder: Move up/down buttons (SC 2.5.7).
- Zoom: no new pinch handler. Existing state for the auditor: `.terminal-host` sets `touch-action: none`, so a pinch that starts on terminal output likely does not zoom the page (SUSPECTED from CSS, not device-tested); pinch elsewhere and Safari's page zoom still work. Text resize to 200 percent (SC 1.4.4) is reachable through Font size (14 px default to 32 px) and page zoom. Verify both on device; the viewport meta does not block zoom (`index.html:5`).
- Focus and keyboard: `More keys` has `aria-expanded` and `aria-controls`; the panel is `role="group"` labelled `More keys`; Escape closes it and focus returns to `More keys`. Panel key buttons use the same focus-keeping press handling as the row for touch, and normal focus for hardware keyboards and VoiceOver.
- Editor: after a move, focus stays on the same control of the moved row (it follows the key), and an `aria-disabled` end button keeps focus instead of dropping it. One polite live region for move/add/remove/reset and Settings save status.
- Status messages (SC 4.1.3): `Resuming`, `Back in session.`, disconnection, `Download resumed.` are polite; X-05 to X-07 failures use `role="alert"` once. Do not announce every percent change: the existing `role="status"` progress line announces too often; throttle to state changes and every 25 percent (change to existing behavior).
- Focus is never moved on page return. A screen reader user hears the announcement and finds `Reconnect` where the key bar was, the next control after the terminal in DOM order.
- Recovery row and transfer block: state in text, primary action by position and fill, never color alone. No danger color: a dropped session or paused download is not a destructive decision.
- Combined landscape row: the truncated target's button name holds the full `user@host:port` and state. Focus outline stays visible inside the 44px row (SC 2.4.11; the row must not be covered by the keyboard).
- Targets: every new control 44 by 44 CSS px (DESIGN.md rule; above WCAG 2.2 SC 2.5.8's 24px minimum).
- Reduced motion: no new motion. Panel open/close and recovery row swap are instant; the Settings sub-view change is instant (no slide).
- Hand to the accessibility auditor: VoiceOver through More keys and the editor; editor with Full Keyboard Access; announcements on return from background; 200 percent text in the key bar (does a 32 px setting change key face size? it should not; key faces follow UI type, not terminal type); landscape combined row with the keyboard up; contrast of the faint marker line in every terminal theme.

WCAG references are WCAG 2.2 SC 1.4.4, 2.4.11, 2.5.1, 2.5.7, 2.5.8, 4.1.3, https://www.w3.org/TR/WCAG22/, the same Recommendation 02 cites (accessed 2026-11-02). I did not re-fetch it in this step.

## 8. Already-built T5 behavior that must change

ID | BUILT | WHERE | CHANGE | CONFIDENCE
--- | --- | --- | --- | ---
B-01 | Key bar scrolls horizontally with all keys | `app.css:1122-1136` (`overflow-x: auto`, `touch-action: pan-x`), `KeyBar.tsx` | Fit-to-width row with fixed Keyboard first and `More keys` last; More keys panel (4.2). | MED
B-02 | Ctrl and Alt always render before the other keys | `KeyBar.tsx:61` | Modifiers become ordinary items in the ordered list; still sticky with once/locked states. | MED
B-03 | Fixed key list and order | `terminalKeys.ts:42` | Add `shift-tab` (`\x1b[Z`), `text-smaller`, `text-larger`; new default order K-02; order read from settings. | MED
B-04 | Key bar hidden when the active tab has no handle | `App.tsx:804` | On touch, render the recovery row in that slot (S-15 to S-19). | HIGH
B-05 | Switcher status is binary `Connected`/`Disconnected` | `App.tsx:575` | Add `Resuming` and `Connecting to <host>...` text states. | HIGH
B-06 | `Select text` shown only with a live handle | `App.tsx` `terminal-select-button` guard (`tab.handle &&`) | Show on disconnected tabs too, so closed-session output can be copied. | MED
B-07 | Phone gesture legend inside the Appearance picker | `TerminalSettings.tsx:115` | Moves to Help per 08 S-08; its text names More keys and two-finger scroll, and states that pinch does not change text size. | MED
B-08 | WebKit `tap()` sends no bytes from the key bar (T5-01) | `KeyBar.tsx:83` | Fix in the same task as B-01; it owns `KeyBar.tsx`. Not a design change. | HIGH

Unchanged and kept: one 44px session row, `Open terminals` switcher and its dismissal, drag-only scrollback, visual viewport sizing, Files replacing the terminal, Keyboard toggle behavior. New, not a T5 change: short-landscape combined row (L-10), Settings Key bar section and editor, per-host scope, transfer states.

For the architect (11), not a design change: `App.tsx:194` closes every session on `pagehide`, and `FilePanel.tsx:235` releases held downloads on `pagehide`. The return flow (S-13) and X-02 assume the v2 path survives a background switch; 11 must state which page lifecycle events end a session or a transfer.

## 9. DESIGN.md delta (proposed; DESIGN.md unchanged in this step)

ID | SECTION | DELTA | CONFIDENCE
--- | --- | --- | ---
M-01 | System | Add to the idea: "When the active target's connection drops, the key bar slot becomes the recovery control for that target." | MED
M-02 | Tokens, icons | Settings `Settings` (from 08); `More keys` glyph TBD from the pinned lucide set (visible text label required regardless); editor uses `ArrowUp`, `ArrowDown`, `X` (remove), `Plus` (add), `ChevronLeft` (back), `ChevronRight` (Edit key bar row); reconnect `RefreshCw` is already used in Files, so `Reconnect` stays text-only to avoid two meanings. No new color, type, spacing, or motion token. | MED
M-03 | Layout, Session phone | Key bar: fixed Keyboard first, ordered keys that fit, fixed `More keys` last; no horizontal scroll. More keys panel takes the system keyboard's place, up to four key rows, capped at 40 percent of the visual viewport. | MED
M-04 | Layout, Session phone | While the active tab is disconnected, the recovery row replaces the key bar: cause text, optional tmux hint, `Close terminal`, `Reconnect` (primary, right). | HIGH
M-05 | Layout, Session phone | Short landscape (visual viewport under 400px tall, over 600px wide): session row merges into the key bar row at the top of the visual viewport. Exception to "target wraps, never clips": here the target may middle-truncate past 35 percent of the row; its accessible name and the switcher keep the full target. | LOW, needs device proof
M-06 | Layout, Settings | Sections Terminal, Key bar (coarse pointer only), Session. Key bar editor is a sub-view of the Settings sheet or dialog with Back and Close in the sticky header. | MED
M-07 | Components, Settings | Terminal section `Apply to` (All hosts / This host) for saved hosts only; overrides live in the vault record. States H-01 to H-05. | MED
M-08 | Components, Key bar editor | Ordered rows with Move up, Move down, Remove; Not in key bar group with Add; live divider for this screen's row capacity; Reset key bar. No drag in this phase. States K-01 to K-06. | MED
M-09 | Components, Files | Transfer states: downloading, paused in background, resuming, resumed, could not resume (resume from offset), could not resume (file changed, retry), stopped by connection loss, done. Show only actions that can work. Progress announcements on state change and every 25 percent. | MED, depends on 11
M-10 | Components, Phone sessions | States add Resuming, Resumed, Session ended, Reconnecting, Reconnect needs sign-in, Reconnected (marker line), Reconnect failed. | MED
M-11 | Rules | No touch gesture changes font size; no pinch handler. Text size changes come from Settings or the Text keys. A touch gesture never sends shell input (extends existing rule). Keyboard toggle and `More keys` are never removable. Per-host settings never go to plain storage. | HIGH
M-12 | Open items | Q-01 to Q-06 below; device proof for L-10; default key order validation. | LOW

## 10. Open questions and validation

- Q-01, architect (11): resume timeout before S-15, and whether input typed during S-13 is dropped (this spec) or buffered.
- Q-02, architect (11): does a download's partial data survive (a) a background switch, (b) session end within the same page, (c) page eviction and reload? X-07 `Resume download` and the hint wording depend on it. If (c) is no, Help must state that iOS can close the page and lose the download.
- Q-03, architect: how is "file changed on the server" detected (size and mtime at start versus at resume)? X-06 relies on it.
- Q-04, writer: final wording for the download hint, recovery cause lines, and marker line.
- Q-05, planner: vault schema field for per-host terminal settings, and migration for existing records (absent field means all-hosts settings).
- Q-06, product: Reconnect with a stored key or password connects without a further tap. Is one tap acceptable for a host whose session dropped on a shared device, given the 08 risk text? Assumed yes, MED.
- V-06: do users notice `More keys`, and how often do they open it per session? (No data supplied.)
- V-07: default order K-02 versus the current history-first order, observed with keyboard down and up.
- V-08: after returning from another app, can users tell Resuming from Disconnected, and do they find Reconnect without help?
- V-09: is the combined landscape row usable, and is the truncated target still identifiable?

Not verified: physical iOS Safari background behavior and event order on return, key row capacity with real font metrics, More keys panel height versus real keyboard height, combined-row fit with Dynamic Island insets, VoiceOver announcements, and every 11-dependent transfer state. No code or `DESIGN.md` change was made in this step.
