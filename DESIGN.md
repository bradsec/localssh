# localssh design system

## System

- Surface: Operate, responsive browser SSH workbench. Redesign mode: full visual overhaul of app chrome and connect layout. Product behavior and language remain governed by `PRODUCT.md`.
- Direction: calm, compact, precise. The shell is the primary instrument; connection and saved hosts are adjacent work areas, not a marketing presentation.
- Idea: On this app, the active SSH target becomes the fixed point that organizes connection, tabs, files, and help. On phone, the target opens the session switcher. If its connection drops, the key bar slot becomes that target's recovery control.
- Primary jobs: connect to the intended server, verify its host key, work in a terminal, and recover from failures. Keep the relay outside the credential boundary.

## Tokens

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| Canvas | `#F6F8F7` | `#151C1E` | App background |
| Surface | `#FFFFFF` | `#1D2729` | Form, toolbar, dialog, file panel |
| Surface subtle | `#ECF1F0` | `#263235` | Hover, selected neutral area |
| Text | `#202A2B` | `#E6EDEF` | Primary copy |
| Text muted | `#506062` | `#AAB9BB` | Secondary copy and labels |
| Border decorative | `#D6DFDD` | `#39484B` | Dividers only |
| Border control | `#788B8D` | `#74888A` | Input outline and control affordance |
| Accent | `#245D6B` | `#75C1D1` | Primary action, active tab indicator, focus |
| Accent text | `#FFFFFF` | `#151C1E` | Text on accent |
| Danger | `#A53636` | `#F09994` | Errors and changed host key only |
| Danger surface | `#FFF1F0` | `#342326` | Error panels |
| Success | TBD | TBD | Success feedback only, never decoration |

- Contrast checks by WCAG relative luminance: light text/canvas 13.79:1, muted/canvas 6.17:1, accent/white 7.36:1, control border/white 3.57:1. Dark text/canvas 14.57:1, muted/canvas 8.52:1, accent/canvas 8.47:1. Dark control border/surface must be checked at implementation because the adjacent surface differs from canvas.
- Keep the existing bundled IBM Plex Sans and IBM Plex Mono. UI scale in CSS px: title 24/30 weight 600; section 18/24 weight 600; body and controls 14/20 weight 400 or 600; secondary 13/18; metadata 12/16. Inputs remain at least 16px. Terminal font family, size, theme, and user settings remain separate.
- Spacing scale in CSS px: 4, 8, 12, 16, 24, 32. Use 16px for control grouping, 24px between work areas, 8px for label to field. Do not create elastic blank space between Connect and Saved hosts.
- Radius: controls 6px, panels and dialogs 8px, terminal viewport 0px. Elevation: no shadow on the connect work area; one 0 8px 24px rgba(0,0,0,.16) shadow for overlays only.
- Icons: local `lucide-react` package through npm and Vite, pinned to exact version `1.59.0`, named imports only. Default icon size 18px, stroke width 2, set once by `LucideProvider`. No CDN or runtime fetch. Do not mix icon families. The GitHub brand mark remains a brand asset.
- Icon map: Settings `Settings`, Help `CircleHelp`, About `Info`, Files `FolderOpen`, Disconnect `LogOut`, Clipboard `Clipboard`, Actions and saved-host row menu `Ellipsis`, New terminal and Save current host `Plus`, tab close `X`, dropped tab `Unplug`, key bar `Keyboard` and `ChevronDown`, editor `ArrowUp`, `ArrowDown`, `X`, `Plus`, `ChevronLeft`, `ChevronRight`, host key `TriangleAlert` and `KeyRound`, saved hosts `LockKeyhole`, `Pencil`, `Trash`. More keys and Reconnect keep visible text labels. Help and About never share a glyph.
- Motion: 120ms color or border feedback, 160ms overlay entrance if useful, no movement for terminal resizing or tab switching. Reduced motion makes transitions instant. No looping status lamp.

## Layout

- Breakpoints: phone below 720px, tablet 720 to 1023px, desktop 1024px and up. Keep a usable 320px minimum. Breakpoints describe layout changes, not device identity.
- Breakpoint decisions (step 3): during a session the toolbar collapses its controls into one `Actions` menu below 1024px, because the direct controls overlapped the brand and target at 768px. Connect uses two columns from 1024px and one 640px column below. Files is a side pane from 920px (560px terminal plus 360px pane) and replaces the terminal below.
- Connect desktop: 12-column grid capped at 1120px, 24px gutters. Connection occupies 7 columns, Saved hosts 5 columns. Top align both. No surrounding split hero card. Below 1024px use one column. The form has no `Connection details` heading; the page title sits directly above Host. At phone use one column with 16px side padding and 24px between work areas.
- Connect visual order and DOM order: page title, connection fields and Connect action, Saved hosts. The connection form must not depend on vault setup. No centered vertical positioning.
- Session desktop: 56px toolbar, 48px tab strip, remaining visual viewport for terminal. Files panel is a 360px side pane; terminal retains at least 560px. At narrower widths Files replaces the terminal viewport with a clear return control.
- Session phone: one 44px minimum target and `Actions` row, up to 60px when the target wraps. Omit the standalone wordmark and permanent tab strip during an active session. The target opens `Open terminals` with session entries, separate close controls, and `New terminal`. The terminal fills the remaining visual viewport; the fit-to-width key bar (Keyboard first, `More keys` last, no horizontal scroll, overflow in a `More keys` panel capped at 40 percent of the visual viewport) stays above the bottom safe area and keyboard. Keep both toolbar targets separate and at least 44px.
- Short phone landscape: below 400px visual viewport height and above 600px width, the target and key bar share one top row when the keyboard opens. The target may middle-truncate past 35 percent of this row; its accessible name and switcher retain the full target. LOW confidence pending physical device proof.
- Disconnected phone session: a recovery row replaces the key bar with cause text, optional tmux hint, Close terminal, and Reconnect. Select text remains reachable for closed-session output.
- Settings: dialog up to 560px from 720px width, full-height sheet with sticky header below. Sections are Terminal, Key bar on coarse pointers, then Session. The Key bar editor opens as a sub-view with Back and Close.
- Help: a dialog on desktop, full-height sheet on phone. Topic navigation and search stay visible; article content scrolls in a 60 to 75 character column. The close control remains reachable with a software keyboard.
- Host-key prompt: desktop dialog capped at 560px; phone inset sheet with a scrollable fingerprint block and sticky actions above the safe area. Keep existing text and action labels.

## Components

- All buttons, inputs, selects, summaries, tab controls, and key controls have at least 44 by 44 CSS px hit regions. Exception: Files panel rows and panel toolbar controls are 32px tall under fine pointers (mouse, trackpad) for density, still above the WCAG 2.2 SC 2.5.8 24px minimum, and return to 44px under `(pointer: coarse)`. Keep persistent labels and visible 3px focus outlines with 2px offset. Icon-only controls require accessible names.
- Primary button: one per task region. Default accent fill; hover accent darkens in light mode or lightens in dark; active no positional shift; focus outlined; disabled shows text plus disabled affordance; loading uses current action text and reserves width.
- Secondary button: surface fill, control border, text. Destructive button: danger fill or border only at a destructive decision. Menus and dialogs restore focus to their trigger.
- Inputs: surface fill and control border; hover strengthens border; focus uses accent outline; invalid state shows text and danger border; disabled state stays readable. Do not use placeholder as label.
- Tabs: active state uses a 2px accent underline and text weight, not an inverted pill. Inactive, hover, focus, connecting, disconnected, and close affordances must differ without relying on color alone. A tab whose session dropped shows the `Unplug` icon and the word `Disconnected` whether or not it is selected; a connecting tab reads `Connecting to <host>...`. Retain keyboard tab navigation.
- Phone sessions: the target switcher shows the full `user@host:port`, connection state, and a chevron. `Open terminals` keeps selected, connecting, and disconnected states in text. Escape, outside tap, and Close dismiss it; dismissal restores focus to the target.
- Phone touch: one-finger vertical drag scrolls output; horizontal drag and prompt flick send no hidden Tab, Esc, or arrow keys. Use the visible key bar, with Keyboard first, ordered keys from Ctrl, Esc, Tab, Shift Tab, Up, Down, Enter, Backspace onward, and More keys last. Stationary long press and `Select text` open the read-only selectable snapshot view. Desktop and tablet terminal gestures remain unchanged.
- Status: show `Connecting`, `Connected`, or `Offline` only where it answers a task question. No idle lamp or pulsing dot. Include target and connection state in text during sessions.
- Saved hosts: absent, locked, unlocked empty, unlocked populated, busy, storage unavailable, stale save, reset confirmation. Each state keeps Connect independent and preserves current error and recovery language.
- Files: current folder, path, upload, list, transfer progress, empty, loading, error, overwrite confirmation, and close-during-transfer confirmation. Keep the current file and permission warnings. `Replace file` uses the danger treatment; `Stop and close` does not, because an unfinished upload leaves the remote file unchanged.
- Toolbar overlay panels (About, Clipboard): below 720px they anchor to the toolbar's right edge, not to their icon, so they stay inside a 320px viewport. Inside the Actions menu they open in place.
- Settings: Terminal changes apply live; keep-alive applies to newly opened terminals. Changes save on selection, without Save or Cancel. The active target appears in the terminal preview. The Session section shows cap loading, effective cap, no limit, unsupported relay, unknown cap, Off, and save status. The keep-alive risk text remains visible. Apply to offers All hosts or This host for an unlocked saved host; per-host values live in the vault. States H-01 to H-05 apply.
- Key bar editor: ordered rows offer Move up, Move down, and Remove; a separate list offers Add. A live divider shows which keys fit in the current row. Reset key bar restores defaults. Keyboard and More keys remain fixed. States K-01 to K-06 apply.
- Files transfer: show downloading, paused, resuming, resumed, resume failure, changed file, stopped, and done states. Offer only actions that can work. Announce state changes and each 25 percent of progress.
- Phone recovery: show Resuming, Resumed, Session ended, Reconnecting, Reconnect needs sign-in, Reconnected with a marker line, and Reconnect failed in text. Recovery controls replace the key bar on a closed active tab.
- Help: search, topic list, article, no results, close, and contextual topic entry. Keep headings, existing article text, and focus return behavior.
- Host key: first connection and changed key remain distinct. Changed key uses danger styling and preserves both fingerprints and the explicit replacement decision.

## Rules

- Freeze navigation labels, URLs, form names and order, copy voice, analytics names, legal text, host-key wording, and product name unless a later task changes them. This redesign request authorizes removal of the ornamental connect copy named by the user.
- Do not claim a successful user outcome from screenshots. Test with users on desktop and physical phones.
- Do not add accounts, credential storage outside the browser, or plaintext handling by the relay. The Go WASM engine remains in the page.
- Keep light and dark parity, safe-area padding, 16px input text floor, 44px touch targets, visible focus, and reduced motion.
- A server cap appears with the effective time; do not silently replace the user's choice. Touch gestures send no shell input or font-size change. Use Settings or Text keys for size. Never remove Keyboard or More keys. Never store per-host settings in plain storage.
- Avoid gradient hero, generic logo tile, status lamps, eyebrow labels, version footers on the connect view, two-tone split cards, oversized shadows, and decorative pills.

## Open items

- Confirm whether the existing `>_` tile is a formal brand asset. The current brief treats it as UI decoration; preserve the localssh wordmark.
- Dark control border `#74888A` on surface `#1D2729` measured 4.10:1 in step 2 (closed).
- `--terminal-shell` `#1A1B26` in `app.css` is the Tokyo Night background used for the terminal frame and padding. It is not a token in this table and does not follow a non-default terminal theme. Decide whether the frame follows the selected terminal theme.
- Connect screen signature: the target idea shows only in the session toolbar. Proposal: a read-only mono line above `Connect to server` that composes `username@host:port` from the fields as typed, using the same style as the session target, so the connect screen and session share one fixed point. Needs a copy and accessibility decision before building.
- Success token remains TBD; nothing uses it.
- Run a full WCAG 2.2 AA audit and physical iOS/Android checks after implementation. Current Chromium captures do not prove mobile browser or screen reader behavior.
- Verify physical iPhone portrait and landscape with the keyboard open and closed, VoiceOver, zoom, safe areas, scrollback, and native selection handles in the read-only view. WebKit automation does not prove those device behaviors.
- Validate the default key order and More keys discovery with users. The short landscape target truncation remains LOW confidence until physical device testing.
