# Redesign step 1: UI/UX design

Designing: responsive SSH workbench for self-hosted server operators connecting and working quickly, vibe calm and precise, on web, design system new. Surface: form-heavy app. Mode: Operate. Redesign mode: full visual overhaul of app chrome and connect layout. `PRODUCT.md` remains product truth.

## Design read

ID | DECISION | CONFIDENCE | EVIDENCE
--- | --- | --- | ---
R-01 | VARIANCE 3/10: conventional task geometry with a clear target line; visual character comes from terminal typography, not asymmetry | HIGH | The SSH task and existing form labels favor scanning over expression; this is a design judgment, not user research.
R-02 | DENSITY 7/10: compact form and session controls, with 44px touch targets retained | HIGH | Current desktop wastes a full intro column while phone height is scarce in captures.
R-03 | MOTION 2/10: instant tab and terminal changes, brief control feedback only | HIGH | Motion delays shell work and the current pulsing lamp adds no required information.
R-04 | The active SSH target is the organizing line across connect, tabs, files, and help | MED | Connect and terminal already share host identity; user validation is still needed.

Material, real: product facts and security boundary in `PRODUCT.md`; bundled IBM Plex fonts; working connection, vault, tabs, SFTP, Help, host-key prompt; 42 Chromium captures in [`01-before/`](01-before/), at 390x844, 768x1024, 1440x900, light and dark.

Material, absent: customer proof, usage data, representative research, audited security claims, product photography. No sample metrics, logos, or invented server data belong in the design. Captured `test box` and `127.0.0.1` are test fixtures only.

Idea: **On this app, the active SSH target becomes the fixed point that organizes connection, tabs, files, and help.** It appears in the first view as a compact target-oriented form and persists as a clear session identity after connection. Competitor test: substituting an ordinary browser SSH client weakens the idea because localssh specifically keeps the Go SSH engine in the page and the relay blind to credentials; the UI should make the browser-owned session legible without claiming unaudited security.

Rejected A: a dark-only hacker console. It would reduce legibility in daylight and discard the current light/dark preference, with no task gain. Rejected B: another centered split card with smaller heading and new colors. It leaves the same dead column, bottom gap, and marketing-page composition.

## Current interface audit

ID | SEVERITY | CONFIDENCE | screen/section | problem | fix
--- | --- | --- | --- | --- | ---
A-01 | CRITICAL | HIGH | phone terminal and Files, [`App.tsx:387`](../../frontend/src/App.tsx), [`app.css:164`](../../frontend/src/app.css), [`app.css:1849`](../../frontend/src/app.css) | At 390px the session toolbar controls overlap the brand and Files covers it; both captures show unreadable, colliding actions. | Use a two-row session header or one labeled overflow menu with a stable 44px hit target. Keep target and session state visible.
A-02 | HIGH | HIGH | desktop connect, [`app.css:628`](../../frontend/src/app.css), [`app.css:657`](../../frontend/src/app.css), [`app.css:713`](../../frontend/src/app.css) | Intro occupies an empty full-height column; `Saved hosts` starts 84px below Connect and reaches the card's bottom edge. | Top-align independent connection and saved-host work areas on the page grid; use a fixed 24px vertical or column gap.
A-03 | HIGH | HIGH | connect, [`ConnectDialog.tsx:140`](../../frontend/src/components/ConnectDialog.tsx), [`ConnectDialog.tsx:142`](../../frontend/src/components/ConnectDialog.tsx), [`app.css:684`](../../frontend/src/app.css) | `NEW SESSION`, two-line hero, marketing subtitle, two-tone split, heavy shadow, and stranded version read like a landing page before a form. | Lead with a 24px task title and fields; remove ornamental intro and its full-height background.
A-04 | HIGH | HIGH | toolbar and vault, [`App.tsx:389`](../../frontend/src/App.tsx), [`app.css:215`](../../frontend/src/app.css), [`SavedHosts.tsx:31`](../../frontend/src/components/SavedHosts.tsx), [`app.css:1721`](../../frontend/src/app.css) | Rounded `>_` tile, glowing Offline lamp, `Optional` pill, and Clipboard dot spend attention on decoration. | Retain localssh wordmark and meaningful text status; remove lamps, dots, and optional badge. Show vault state in its heading or body.
A-05 | HIGH | HIGH | phone connect, [`app.css:1876`](../../frontend/src/app.css), [`app.css:1920`](../../frontend/src/app.css) | The intro consumes about 220px before the first field at 390px, so the Saved hosts region starts below the initial viewport. | Place title and form first with no intro panel; preserve page scroll and direct vault access below.
A-06 | MEDIUM | HIGH | terminal tabs, [`app.css:323`](../../frontend/src/app.css), [`app.css:357`](../../frontend/src/app.css) | Inverted rounded tabs look like separate buttons rather than a continuous session strip; repeated host labels need disambiguation. | Use an underline or edge selection and show the target in the active session header. Keep accessible tab names and close controls.
A-07 | MEDIUM | HIGH | Files, [`FilePanel.tsx:286`](../../frontend/src/components/FilePanel.tsx), [`app.css:408`](../../frontend/src/app.css) | Native upload control, path actions, and empty copy are ungrouped in a broad pane; loading text can leave the pane looking unfinished. | Align location, path, upload, transfer state, and list on a compact panel grid; keep native file selection semantics.
A-08 | MEDIUM | HIGH | Help, [`Help.tsx:150`](../../frontend/src/components/Help.tsx), [`app.css:1538`](../../frontend/src/app.css) | Phone dialog shows topic chips followed by long article text; the opening does not answer a selected task immediately. | Keep search and topic navigation fixed; scroll one article region with a reading measure. Preserve topic labels and copy.
A-09 | MEDIUM | HIGH | first host-key prompt, [`HostKeyPrompt.tsx:137`](../../frontend/src/components/HostKeyPrompt.tsx), [`app.css:1287`](../../frontend/src/app.css) | Fingerprint is clear, but phone actions stack at the dialog's end and the prompt has an ornamental eyebrow and top border. | Make comparison and fingerprint the hierarchy; place Cancel and Trust in a stable action area. Preserve exact warning text and changed-key distinction.
A-10 | LOW | HIGH | icon family, [`Icon.tsx:1`](../../frontend/src/components/Icon.tsx), [`ClipboardMenu.tsx:198`](../../frontend/src/components/ClipboardMenu.tsx), [`KeyBar.tsx:94`](../../frontend/src/components/KeyBar.tsx) | Material paths plus separate hand-drawn clipboard and keyboard cue make three icon treatments. | Replace UI icons with local Lucide named imports; keep the GitHub brand mark as a brand asset.

Earlier review D-01 fixed Connect visibility and D-05 added Help. Preserve those wins. Current IA is one connect view, live session tabs, Files per tab, and Help/Appearance/About overlays. Keep existing labels, URLs, field names and order, Help text, error language, analytics identifiers, and security copy except the named ornamental intro text. Source inspection found no analytics event names in the affected components.

## Information architecture and task flow

ID | DECISION | CONFIDENCE | EVIDENCE
--- | --- | --- | ---
F-01 | Connect question: Which server and credentials should this session use? Data: host, port, username, auth method, secret. Primary action: Connect to server. | HIGH | Current form and `PRODUCT.md`.
F-02 | Saved hosts question: Which saved target should I reuse? Absent, locked, unlocked empty, and unlocked populated are local states beside or below the independent form. | HIGH | `SavedHosts.tsx` and captures.
F-03 | Host-key question: Does this SHA-256 fingerprint match the server I intended? Cancel precedes trust. Changed key shows both fingerprints and a more guarded replacement action. | HIGH | `HostKeyPrompt.tsx` and product security boundary.
F-04 | Terminal question: Which live target am I controlling? Tabs switch sessions; Files, Clipboard, Appearance, Help, About, and Disconnect remain supporting actions. | HIGH | `App.tsx` and captures.
F-05 | Files question: Where am I on the remote server, and what transfer is active? Keep file operations on the current tab's SSH connection. | HIGH | `FilePanel.tsx` and `PRODUCT.md`.
F-06 | Help question: How do I finish or recover the current task? Context links open the existing topic; search and topic list support exploration. | HIGH | Existing in-app Help flow.

Shortest path: load connect, enter host, port, username, and password or private key, press Connect, verify fingerprint, then work in terminal. Repeat path: unlock address book, choose saved host, verify if needed, then work. Files opens within the active session. A new terminal opens a connection form without closing existing tabs. Disconnect or close tab returns to another live tab or the connect view.

## Layout specification

The drawings show structure, not replacement copy. Preserve current labels and wording where shown. `*` marks the primary action in that task region.

### Connect, desktop 1440x900

```text
56px toolbar  localssh                                      Appearance  Help  About
24px top gap
1120px max grid, 12 columns, 24px gutters
| Connection, 7 cols                 | Saved hosts, 5 cols              |
| Connect to your server             | Saved hosts                     |
| Host                        Port   | absent: setup explanation        |
| Username                           |         master password          |
| Authentication method              |         confirm password         |
| Password OR private-key inputs     |         Create address book      |
|                     *Connect       | locked: password, Unlock, help  |
| inline connection error            | unlocked: host rows, actions    |
```

Use 24px from title to fields, 16px between field groups, 8px label gaps. Form and vault are separate surfaces, top aligned. No outer card, intro column, giant shadow, or bottom pinning. The vault can grow without stretching the form. Keep private-key details in the selected auth branch. Keep the Connect button adjacent to its form fields, with error directly below.

### Connect, phone 390x844

```text
48px toolbar  localssh                       Appearance  Help  About
16px side inset
Connect to your server
Host                         Port
Username
Authentication method
Password OR private-key inputs
*Connect to server, full width
inline error if any
24px gap
Saved hosts
absent: setup explanation, two fields, Create address book
locked: master password, Unlock saved hosts, recovery link
unlocked: saved rows, Save current host, Change master password
```

The connect task appears before the vault in DOM and visual order. The page scrolls normally above the phone keyboard. At 320px the Host/Port row may stack if 88px Port plus gaps makes Host too narrow. The vault is never nested in a clipped card. At tablet 768px, keep two columns only if both work areas retain readable input widths; otherwise stack them with the same order.

### Vault state details

ID | DECISION | CONFIDENCE | EVIDENCE
--- | --- | --- | ---
V-01 | Absent: show current explanatory copy, password strength, master password, confirmation, then Create address book. Avoid `Optional` badge. | HIGH | Current setup form and user complaint.
V-02 | Locked: heading includes `Locked`, master password and Unlock stay visible; forgotten-password recovery remains secondary. Connect stays usable. | HIGH | Current locked flow and capture.
V-03 | Unlocked empty: `No saved hosts yet` plus current guidance and Save current host. Populated: rows show nickname first, user@host:port second, with separate 44px options menu. | HIGH | Current `SavedHosts.tsx` flow.
V-04 | Busy and stale vault: keep the action in place with status text. Errors sit under the affected action. Reset uses the existing confirmation phrase and danger action. | HIGH | Existing state handling.

### Terminal and tabs

```text
DESKTOP: 56px toolbar  localssh | Connected, user@host:port | Files  Disconnect  Clipboard  Appearance  Help  About
         48px tabs     [host A][host B selected][New terminal]
         remaining     terminal viewport, no floating bezel
         optional      Files 360px on right; terminal >=560px

PHONE:   48px toolbar  localssh | short target | Actions
         44px tabs     horizontally scrollable, active underline, close controls
         remaining     terminal viewport
         44px key bar  Keyboard  ctrl  alt  tab  esc  arrows..., horizontal scroll
         safe area     system inset
```

The phone Actions menu holds Files, Disconnect, Clipboard, Appearance, Help, and About using their existing labels. The desktop toolbar may show them directly. Keep target text and `Connected` or `Connecting` in the session header; omit `Offline` on the idle connect view. A disconnected tab keeps its status in text. Tab selection is immediate and retains xterm focus. Do not add a key bar to desktop merely for visual symmetry.

### Files, Help, and host key

```text
FILES desktop: terminal | 360px panel: Files / Close files; Current folder; Remote path + Up/Open; Upload file; transfer status; file list
FILES phone:   Files / Close files; Current folder; Remote path + Up/Open; Upload file; transfer status; file list; terminal returns on Close
HELP desktop:  640px dialog: title/Close; search; topic navigation; one scrollable article column
HELP phone:    viewport-height sheet: title/Close; search; horizontally or vertically wrapped topics; article scrolls below
HOST desktop:  560px dialog: title; explanation; fingerprint(s); Cancel and Trust/Replace
HOST phone:    inset sheet: title; explanation; breakable fingerprint(s); sticky action row above safe area
```

Files stays scoped to the active tab. Its empty state names the current folder and keeps upload and path controls visible. A transfer shows filename, percentage, and Cancel in one status row. Overwrite and close-during-transfer warnings remain explicit. Help opens the relevant topic from context and restores focus on close. Host-key changed uses danger styling and two labeled fingerprints; first connection uses one fingerprint. The two host-key cases keep their existing security language and button labels.

## Visual and interaction system

ID | DECISION | CONFIDENCE | EVIDENCE
--- | --- | --- | ---
S-01 | Use the tokens, type scale, spacing, radii, grid, and component contracts in root [`DESIGN.md`](../../DESIGN.md). | HIGH | Existing IBM Plex assets and measured layout faults.
S-02 | Keep IBM Plex Sans for UI and IBM Plex Mono for host, port, fingerprint, and terminal chrome. The terminal's own configured font remains independent. | HIGH | Bundled fonts and existing settings.
S-03 | Use one deep petrol accent, `#245D6B` light and `#75C1D1` dark; reserve red for errors and changed host keys. | MED | Computed token pairs pass stated text and control criteria; full rendered audit remains.
S-04 | Focus: 3px accent outline with 2px offset. Hover changes border or fill in 120ms; active uses color, not a vertical jump. | HIGH | Visible focus and stable controls matter for operation.
S-05 | Loading: action text changes in place; preserve button width. Terminal or Files show text progress without pulsing lamp. | HIGH | Existing loading copy and reduced-motion requirement.
S-06 | Reduced motion: all overlay and control transitions become instant; never animate terminal geometry or tab switching. | HIGH | Task continuity and WCAG motion preference convention.

Contrast calculations use WCAG relative luminance on proposed solid tokens: light text/canvas 13.79:1, muted/canvas 6.17:1, accent/white 7.36:1, control border/white 3.57:1; dark text/canvas 14.57:1, muted/canvas 8.52:1, accent/canvas 8.47:1. These checks cover token pairs, not antialiasing, overlays, terminal themes, or every component state. Dark control border on dark surface and danger pairings require implementation checks. The W3C WCAG 2.2 AA criteria specify [4.5:1 for normal text](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum) and [3:1 for required UI boundaries](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast), accessed 2026-11-01.

Controls need default, hover, focus, active, disabled, loading, and error states. Inputs retain visible labels and 16px minimum text. Primary actions use accent fill; secondary actions use surface and border; destructive actions use danger only at the decision. Icon-only controls need accessible names. The touch key bar keeps separate once and locked modifier states in text or shape as well as color. Do not let hover styling be the only distinction on touch screens.

## Lucide icon plan

Install `lucide-react` into the existing frontend npm lockfile. Import named components so Vite bundles only used icons. Set `size={18}` and `strokeWidth={2}` through one app-level convention. Keep SVG decorative with `aria-hidden`; button labels or accessible names carry meaning. No CDN, external font, dynamic icon name lookup, or runtime request. Lucide's [React guide](https://lucide.dev/guide/react/) states named icons are tree-shakable, accessed 2026-11-01.

Current `Icon.tsx` name | Lucide React component | Verified icon page
--- | --- | ---
`logout` | `LogOut` | [log-out](https://lucide.dev/icons/log-out)
`palette` | `Palette` | [palette](https://lucide.dev/icons/palette)
`info` | `Info` | [info](https://lucide.dev/icons/info)
`keyboard` | `Keyboard` | [keyboard](https://lucide.dev/icons/keyboard)
`warning` | `TriangleAlert` | [triangle-alert](https://lucide.dev/icons/triangle-alert)
`key` | `KeyRound` | [key-round](https://lucide.dev/icons/key-round)
`more_horiz` | `Ellipsis` | [ellipsis](https://lucide.dev/icons/ellipsis)
`edit` | `Pencil` | [pencil](https://lucide.dev/icons/pencil)
`delete` | `Trash` | [trash](https://lucide.dev/icons/trash)
`add` | `Plus` | [plus](https://lucide.dev/icons/plus)
`lock` | `LockKeyhole` | [lock-keyhole](https://lucide.dev/icons/lock-keyhole)

Those 11 names cover every key in `Icon.tsx`. Additional UI SVGs: replace `ClipboardMark` with [Clipboard](https://lucide.dev/icons/clipboard) and the keyboard dismiss cue with a labeled Keyboard control state, using [Keyboard](https://lucide.dev/icons/keyboard) plus text or [ChevronDown](https://lucide.dev/icons/chevron-down) if needed. The `GitHubMark` in About is a brand mark, so do not substitute a generic Lucide icon. All icon pages were accessed 2026-11-01. Lucide icon names must be checked against the installed package before implementation because package and site versions can differ.

## Accessibility and validation

ID | DECISION | CONFIDENCE | EVIDENCE
--- | --- | --- | ---
X-01 | Preserve 44x44 CSS px targets, 16px input floor, visible focus, safe areas, text statuses, field labels, and modal focus return. | HIGH | Existing `DESIGN.md` constraints and WCAG 2.2 [target size minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum), accessed 2026-11-01. The web AA floor is 24px with exceptions; 44px is the product rule.
X-02 | Run keyboard, 200% zoom, screen reader, and full WCAG 2.2 AA audit after implementation; include first and changed host-key prompts, Files transfer dialogs, Help, and vault reset. | HIGH | Captures do not test assistive technology.
X-03 | Test physical iPhone and Android keyboard, touch key bar, tab overflow, Files return, and fingerprint reading; test real users on first connection and repeat connection. | MED | Chromium emulation cannot establish mobile browser behavior or usability.

Open question: whether the `>_` tile is an official logo asset. The brief calls it generic; the design removes the tile while preserving the localssh wordmark. If the tile is protected brand artwork, a separate brand decision is needed. Validate the proposed title-first connect view and menu discoverability with server operators, and validate host-key comparison with first-time users. No user outcomes are claimed.

## Implementation handoff

ID | files to change | scope
--- | --- | ---
H-01 | `frontend/src/App.tsx`, `frontend/src/app.css` | Toolbar collision, session status, layout, tabs, responsive grid, light/dark tokens, motion.
H-02 | `frontend/src/components/ConnectDialog.tsx`, `frontend/src/components/SavedHosts.tsx`, `frontend/src/components/SavedHostEditor.tsx` | Remove ornamental intro, top-align work areas, preserve field order and vault states.
H-03 | `frontend/src/components/FilePanel.tsx`, `frontend/src/components/Help.tsx`, `frontend/src/components/HostKeyPrompt.tsx`, `frontend/src/components/KeyBar.tsx` | Panel and dialog geometry, responsive states, key bar icon cue.
H-04 | `frontend/src/components/About.tsx`, `frontend/src/components/ClipboardMenu.tsx`, `frontend/src/components/TerminalSettings.tsx`, `frontend/src/components/Icon.tsx` | Icon swap and small overlay alignment. Delete `Icon.tsx` after callers migrate.
H-05 | `frontend/package.json`, `frontend/package-lock.json`, icon-related component tests, `frontend/e2e/connect-flow.spec.ts`, `frontend/e2e/address-book.spec.ts`, `frontend/e2e/help.spec.ts`, `frontend/e2e/key-bar.spec.ts`, `README.md`, `frontend/README.md` | Local dependency, changed visual and accessible behavior checks, screenshots, and updated user-facing documentation. Keep other engine and relay files untouched.

This is a design handoff only. No production UI code or dependency changed in this step. Captures use the current real WASM engine, local relay, and test SSH server. Browser verification: `1 passed (15.6s)` on the first capture run. The second capture run refreshed locked and Files states. Physical devices, screen readers, and user testing were not run.
