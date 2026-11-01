# localssh design system

## System

- Surface: Operate, responsive browser SSH workbench. Redesign mode: full visual overhaul of app chrome and connect layout. Product behavior and language remain governed by `PRODUCT.md`.
- Direction: calm, compact, precise. The shell is the primary instrument; connection and saved hosts are adjacent work areas, not a marketing presentation.
- Idea: On this app, the active SSH target becomes the fixed point that organizes connection, tabs, files, and help.
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
- Icon map: Appearance `Palette`, Help `CircleHelp`, About `Info`, Files `FolderOpen`, Disconnect `LogOut`, Clipboard `Clipboard`, Actions and saved-host row menu `Ellipsis`, New terminal and Save current host `Plus`, tab close `X`, dropped tab `Unplug`, key bar `Keyboard` and `ChevronDown`, host key `TriangleAlert` and `KeyRound`, saved hosts `LockKeyhole`, `Pencil`, `Trash`. Help and About never share a glyph.
- Motion: 120ms color or border feedback, 160ms overlay entrance if useful, no movement for terminal resizing or tab switching. Reduced motion makes transitions instant. No looping status lamp.

## Layout

- Breakpoints: phone below 720px, tablet 720 to 1023px, desktop 1024px and up. Keep a usable 320px minimum. Breakpoints describe layout changes, not device identity.
- Breakpoint decisions (step 3): during a session the toolbar collapses its controls into one `Actions` menu below 1024px, because the direct controls overlapped the brand and target at 768px. Connect uses two columns from 1024px and one 640px column below. Files is a side pane from 920px (560px terminal plus 360px pane) and replaces the terminal below.
- Connect desktop: 12-column grid capped at 1120px, 24px gutters. Connection occupies 7 columns, Saved hosts 5 columns. Top align both. No surrounding split hero card. Below 1024px use one column. The form has no `Connection details` heading; the page title sits directly above Host. At phone use one column with 16px side padding and 24px between work areas.
- Connect visual order and DOM order: page title, connection fields and Connect action, Saved hosts. The connection form must not depend on vault setup. No centered vertical positioning.
- Session desktop: 56px toolbar, 48px tab strip, remaining visual viewport for terminal. Files panel is a 360px side pane; terminal retains at least 560px. At narrower widths Files replaces the terminal viewport with a clear return control.
- Session phone: 48px minimum main toolbar with localssh, active target, and the `Actions` menu; the target wraps rather than truncates or runs under Actions, so the toolbar may grow by one line at 320px; 44px horizontal tab strip; terminal fills remaining visual viewport; 44px touch key bar above safe area. Never allow toolbar controls to collide or clip.
- Help: a dialog on desktop, full-height sheet on phone. Topic navigation and search stay visible; article content scrolls in a 60 to 75 character column. The close control remains reachable with a software keyboard.
- Host-key prompt: desktop dialog capped at 560px; phone inset sheet with a scrollable fingerprint block and sticky actions above the safe area. Keep existing text and action labels.

## Components

- All buttons, inputs, selects, summaries, tab controls, and key controls have at least 44 by 44 CSS px hit regions. Keep persistent labels and visible 3px focus outlines with 2px offset. Icon-only controls require accessible names.
- Primary button: one per task region. Default accent fill; hover accent darkens in light mode or lightens in dark; active no positional shift; focus outlined; disabled shows text plus disabled affordance; loading uses current action text and reserves width.
- Secondary button: surface fill, control border, text. Destructive button: danger fill or border only at a destructive decision. Menus and dialogs restore focus to their trigger.
- Inputs: surface fill and control border; hover strengthens border; focus uses accent outline; invalid state shows text and danger border; disabled state stays readable. Do not use placeholder as label.
- Tabs: active state uses a 2px accent underline and text weight, not an inverted pill. Inactive, hover, focus, connecting, disconnected, and close affordances must differ without relying on color alone. A tab whose session dropped shows the `Unplug` icon and the word `Disconnected` whether or not it is selected; a connecting tab reads `Connecting to <host>...`. Retain keyboard tab navigation.
- Status: show `Connecting`, `Connected`, or `Offline` only where it answers a task question. No idle lamp or pulsing dot. Include target and connection state in text during sessions.
- Saved hosts: absent, locked, unlocked empty, unlocked populated, busy, storage unavailable, stale save, reset confirmation. Each state keeps Connect independent and preserves current error and recovery language.
- Files: current folder, path, upload, list, transfer progress, empty, loading, error, overwrite confirmation, and close-during-transfer confirmation. Keep the current file and permission warnings. `Replace file` uses the danger treatment; `Stop and close` does not, because an unfinished upload leaves the remote file unchanged.
- Toolbar overlay panels (Appearance, About, Clipboard): below 720px they anchor to the toolbar's right edge, not to their icon, so they stay inside a 320px viewport. Inside the Actions menu they open in place.
- Help: search, topic list, article, no results, close, and contextual topic entry. Keep headings, existing article text, and focus return behavior.
- Host key: first connection and changed key remain distinct. Changed key uses danger styling and preserves both fingerprints and the explicit replacement decision.

## Rules

- Freeze navigation labels, URLs, form names and order, copy voice, analytics names, legal text, host-key wording, and product name unless a later task changes them. This redesign request authorizes removal of the ornamental connect copy named by the user.
- Do not claim a successful user outcome from screenshots. Test with users on desktop and physical phones.
- Do not add accounts, credential storage outside the browser, or plaintext handling by the relay. The Go WASM engine remains in the page.
- Keep light and dark parity, safe-area padding, 16px input text floor, 44px touch targets, visible focus, and reduced motion.
- Avoid gradient hero, generic logo tile, status lamps, eyebrow labels, version footers on the connect view, two-tone split cards, oversized shadows, and decorative pills.

## Open items

- Confirm whether the existing `>_` tile is a formal brand asset. The current brief treats it as UI decoration; preserve the localssh wordmark.
- Dark control border `#74888A` on surface `#1D2729` measured 4.10:1 in step 2 (closed).
- `--terminal-shell` `#1A1B26` in `app.css` is the Tokyo Night background used for the terminal frame and padding. It is not a token in this table and does not follow a non-default terminal theme. Decide whether the frame follows the selected terminal theme.
- Connect screen signature: the target idea shows only in the session toolbar. Proposal: a read-only mono line above `Connect to server` that composes `username@host:port` from the fields as typed, using the same style as the session target, so the connect screen and session share one fixed point. Needs a copy and accessibility decision before building.
- Success token remains TBD; nothing uses it.
- Run a full WCAG 2.2 AA audit and physical iOS/Android checks after implementation. Current Chromium captures do not prove mobile browser or screen reader behavior.
