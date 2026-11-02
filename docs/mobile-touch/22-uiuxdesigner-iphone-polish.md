# Step 22: colour scheme and iPhone polish (uiuxdesigner, targeted refinement)

Designing: localssh app chrome (connect, session toolbar, key bar, panels, Settings) for self-hosters on a LAN opening shells from phone and desktop, doing verified SSH shell work, vibe calm and precise, on responsive web (iPhone Safari portrait as the test device), design system `DESIGN.md` (locked; changes proposed below, not applied).

Mode: targeted refinement. Surface mode: Operate. The brand lives in palette, type, and density, not in layout. IA, labels, copy, and the fixed decisions in `21-next-steps.md` stay frozen.

Dials: VARIANCE 2 (a tool; convention and symmetry help the thumb find keys). DENSITY 7 (the terminal needs every row; chrome stays compact but keeps 44px targets). MOTION 1 (feedback colour changes only, per DESIGN.md).

Evidence read: `DESIGN.md`, `PRODUCT.md`, `frontend/src/app.css` (tokens lines 3-91, toolbar 259-318, tabs 420-510, key bar 1178-1305, phone rules 2683-2930 and 3030-3052, Settings 2385-2470), `frontend/src/terminalThemes.ts`, `frontend/src/components/KeyBar.tsx`, `App.tsx` 960-1000, `frontend/index.html`, `frontend/public/favicon.svg`, screenshots `841a7cbf`, `8a349355`, `ac27b599`, `3b16e429`, `42a66e51` (iPhone, 390 CSS px wide, 3x).

---

## Part A: colour scheme

### A.1 Why the teal reads wrong (diagnosis)

- The default terminal theme is Tokyo Night (`DEFAULT_THEME_NAME`, background `#1A1B26`, a blue-violet near-black). The dark chrome is teal-green (`--surface #1D2729`, `--accent #75C1D1`). On a phone the terminal fills most of the screen, so the chrome reads as a green-tinted frame around an indigo picture: two hue families meeting at the toolbar and key bar borders (visible in every device capture). Contrast is fine; hue harmony is not. Confidence MED (visual judgement from captures, no user testing).
- The app's own favicon already uses an indigo slate (`#2A2E42` tile, `#F8F9FF` glyph). The teal chrome disagrees with the product's own mark.
- `--terminal-shell #1A1B26` (frame and padding stand-in) is Tokyo Night. `.terminal-host` paints `var(--terminal-background, var(--terminal-shell))` (app.css line 690), so the padding already follows the selected theme once applied.

### A.2 Material inventory and idea

Real: the active target `user@host:port` as the fixed point (DESIGN.md idea), IBM Plex Sans and Mono, the Tokyo Night default terminal, the indigo favicon, the cursor block, the `>_` glyph. Absent: brand guidelines, a formal logo, user research on colour preference.

Idea (palette level): the chrome takes its colour from the terminal it frames, so on the default theme the toolbar, key bar, and terminal read as one instrument. Competitor test: generic SSH web clients use a neutral grey or a brand colour unrelated to their terminal theme; this sentence does not fit them. Pass, MED confidence.

### A.3 Token scope

Changed in every palette: `--canvas`, `--surface`, `--surface-subtle`, `--text`, `--text-muted`, `--border`, `--border-control`, `--accent`, `--accent-hover`, `--accent-text`, `--backdrop`, dark `--danger-surface`, and the two `<meta name="theme-color">` values in `frontend/index.html`.

Unchanged (derived or semantic): `--focus` (= `--accent`), `--selection` (mix of `--accent`), `--danger`, `--danger-hover`, `--danger-text`, `--danger-border`, `--strength-*`, `--shadow-overlay`, `--terminal-shell`. `--danger` was re-measured against each new surface below.

Contrast method: WCAG 2.x relative luminance, computed with a script on the exact hex values (not eyeballed). Thresholds: 4.5:1 body text, 3:1 UI components and focus indicator (SC 1.4.3, 1.4.11).

### A.4 Option A (recommended): Iris Slate

Cool slate neutrals tinted toward Tokyo Night's hue, periwinkle accent.

| Token | Light old | Light new | Dark old | Dark new |
| --- | --- | --- | --- | --- |
| `--canvas` | `#F6F8F7` | `#F6F7FB` | `#151C1E` | `#15161E` |
| `--surface` | `#FFFFFF` | `#FFFFFF` | `#1D2729` | `#1E202B` |
| `--surface-subtle` | `#ECF1F0` | `#EDEFF6` | `#263235` | `#282B39` |
| `--text` | `#202A2B` | `#1E2233` | `#E6EDEF` | `#E4E7F2` |
| `--text-muted` | `#506062` | `#525971` | `#AAB9BB` | `#A9AFC7` |
| `--border` | `#D6DFDD` | `#D9DCE7` | `#39484B` | `#363A4D` |
| `--border-control` | `#788B8D` | `#787F99` | `#74888A` | `#777E9B` |
| `--accent` | `#245D6B` | `#3A4FBF` | `#75C1D1` | `#8FA3F7` |
| `--accent-hover` | `#1B4A55` | `#2E3F9C` | `#95D2DE` | `#ADBCFA` |
| `--accent-text` | `#FFFFFF` | `#FFFFFF` | `#151C1E` | `#15161E` |
| `--danger-surface` | `#FFF1F0` | `#FFF1F0` | `#342326` | `#33232B` |
| `--backdrop` | `rgb(14 22 24 / .56)` | `rgb(14 15 24 / .56)` | `rgb(4 8 9 / .68)` | `rgb(4 5 10 / .68)` |
| theme-color meta | `#FFFFFF` | `#FFFFFF` | `#1D2729` | `#1E202B` |

Measured contrast:

| Pair | Light | Dark | Needs |
| --- | --- | --- | --- |
| text / canvas, surface, subtle | 14.73, 15.77, 13.72 | 14.60, 13.12, 11.38 | 4.5 |
| muted / canvas, surface, subtle | 6.48, 6.94, 6.04 | 8.28, 7.44, 6.45 | 4.5 |
| accent as text / canvas, surface, subtle | 6.43, 6.88, 5.99 | 7.51, 6.75, 5.85 | 4.5 |
| accent-text on accent (button) | 6.88 | 7.51 | 4.5 |
| accent-text on accent-hover | 9.10 | 9.74 | 4.5 |
| focus ring (accent) / canvas, surface | 6.43, 6.88 | 7.51, 6.75 | 3.0 |
| border-control / canvas, surface, subtle | 3.71, 3.97, 3.45 | 4.50, 4.04, 3.51 | 3.0 |
| danger / surface, danger-surface | 6.60, 6.00 | 7.47, 6.84 | 4.5 |
| chrome surface vs Tokyo Night bg | n/a | 1.06 (same hue family; the 1px border separates) | none |

Why recommended: removes the hue seam with the default terminal; matches the existing favicon; blue for "action" is a widely used convention so the accent needs no learning; the accent hue sits away from red (danger), amber (strength fair), and green (strength good/strong, future success), so semantic colour stays reserved. Confidence MED (contrast HIGH, aesthetic preference untested).

Risk: dark accent `#8FA3F7` is close to Tokyo Night blue `#7AA2F7` (directory names). Chrome accent appears only outside the terminal (key states, active row underline, New terminal, links), separated by a border, so confusion is unlikely. LOW risk, unverified with users.

### A.5 Option B: Graphite Amber

Near-neutral graphite chrome; amber accent taken from a phosphor cursor.

| Token | Light new | Dark new |
| --- | --- | --- |
| `--canvas` | `#F7F7F6` | `#18191A` |
| `--surface` | `#FFFFFF` | `#202223` |
| `--surface-subtle` | `#EFEFED` | `#2A2C2E` |
| `--text` | `#222322` | `#E8E8E6` |
| `--text-muted` | `#585A58` | `#AFB1AF` |
| `--border` | `#DCDDDA` | `#3A3C3E` |
| `--border-control` | `#7E807D` | `#7D8082` |
| `--accent` | `#8A5200` | `#E8A94C` |
| `--accent-hover` | `#6E4100` | `#F1C27B` |
| `--accent-text` | `#FFFFFF` | `#18191A` |
| `--danger-surface` | `#FFF1F0` | `#352425` |
| `--backdrop` | `rgb(18 18 18 / .56)` | `rgb(6 6 6 / .68)` |
| theme-color meta | `#FFFFFF` | `#202223` |

(Old values as in Option A's table.)

Contrast, light / dark: text on canvas/surface/subtle 14.71/15.77/13.70 and 14.35/13.02/11.42; muted 6.49/6.96/6.04 and 8.16/7.40/6.50; accent as text 5.96/6.39/5.55 and 8.56/7.77/6.82; button text on accent 6.39 and 8.56, on hover 8.68 and 10.68; focus ring 5.96/6.39 and 8.56/7.77; control border 3.72/3.98/3.46 and 4.43/4.02/3.53; danger 6.60/6.00 and 7.37/6.77.

Trade-off: neutral chrome suits every terminal theme equally (no theme favoured). Against: amber is the conventional warning hue and sits next to `--strength-fair` (`#C58A16` / `#E5AE45`); the meter carries a text label so meaning is not colour-only, but the accent loses semantic distance. Confidence MED.

### A.6 Option C: Ink Mono

Neutral graphite; the accent is the ink colour itself (primary buttons near-black in light, near-white in dark).

| Token | Light new | Dark new |
| --- | --- | --- |
| `--canvas` | `#F5F5F4` | `#151617` |
| `--surface` | `#FFFFFF` | `#1E1F21` |
| `--surface-subtle` | `#ECECEA` | `#28292C` |
| `--text` | `#1C1D1F` | `#ECECE9` |
| `--text-muted` | `#55585C` | `#ABADB0` |
| `--border` | `#DADBD9` | `#38393C` |
| `--border-control` | `#7B7E82` | `#7B7E82` |
| `--accent` | `#1C1D1F` | `#ECECE9` |
| `--accent-hover` | `#3A3C40` | `#D4D4D1` |
| `--accent-text` | `#FFFFFF` | `#151617` |
| `--danger-surface` | `#FFF1F0` | `#352425` |
| `--backdrop` | `rgb(16 16 17 / .56)` | `rgb(5 5 6 / .68)` |
| theme-color meta | `#FFFFFF` | `#1E1F21` |

Contrast, light / dark: text 15.46/16.87/14.26 and 15.31/13.93/12.29; muted 6.55/7.15/6.05 and 8.06/7.33/6.47; accent = text values; button text on accent 16.87 and 15.31, on hover 11.05 and 12.20; control border 3.74/4.08/3.45 and 4.44/4.04/3.57; danger 6.60/6.00 and 7.61/6.77.

Trade-off: the quietest option; the terminal output becomes the only colour on screen. Against: accent and body text are the same colour, so links, the active-row underline, `New terminal`, and armed-modifier keys lose their colour cue and rely on underline, weight, and shape alone (DESIGN.md already requires non-colour cues, so this is allowed, but discoverability of `New terminal` drops). Confidence LOW-MED.

### A.7 Terminal theme decision

The terminal theme stays as is (default Tokyo Night, user-selectable list unchanged). Reason: DESIGN.md keeps "terminal font family, size, theme, and user settings separate" from chrome tokens, and the user's request targets the web UI colour scheme. Option A tunes the chrome to the default terminal instead of changing the terminal to match the chrome.

Light mode note (all options): in light OS mode the chrome turns white while the default terminal stays dark Tokyo Night. That pairing exists today and is outside this request; listed as an open question, not changed.

Light-mode focus ring over the dark terminal: accent vs `#1A1B26` measures 2.48 (A), 2.68 (B), 1.01 (C). The terminal draws no app focus ring today (xterm's helper textarea is visually hidden), so nothing fails now. If a focus ring is ever drawn around the terminal frame in light mode, use `--text-muted`-on-dark or a dedicated `--focus-on-terminal` token. SUSPECTED, not a current defect.

---

## Part B: iPhone polish

### B.1 Findings

ID | SEVERITY | screen/section | problem | fix
--- | --- | --- | --- | ---
P-01 | HIGH | Key row | 5 keys fit at 390px (`KeyBar.tsx` capacity: keys area 258px, `floor((258+4)/48)` = 5), leaving 22px dead space before More (captures 841a7cbf, 3b16e429, 42a66e51). Reads as a missing key. | Let row keys grow to share the remainder (B.2.3). Do not shrink keys under 44px.
P-02 | HIGH | Header | Switcher chevron renders iOS system blue (`#007AFF`-like) in every capture: `.session-identity--switcher` is a `<button>` with no `color`, and WebKit's default button colour applies to the `currentColor` SVG. Off-palette, and it looks like a link. | `color: var(--text-muted)` on the switcher (B.2.1). HIGH confidence (CSS plus captures).
P-03 | MEDIUM | Header | Left edges disagree: header text sits at 28px (toolbar 16px plus identity `padding-left: 12px` from the later `.app-shell--session .session-identity` rule, which wins over the switcher's `padding: 0`), terminal text at 6px, keys at 8px. | Phone chrome text inset 12px (B.2.1).
P-04 | MEDIUM | Open terminals | Target is sans 12px muted in the panel but mono 13px in the header. The target is the system's fixed point and should look the same everywhere. | Mono 13/18 in panel rows (B.2.2).
P-05 | MEDIUM | Header | Three type sizes in one 50px row: status 12/16, target mono 13/18, `Actions` 14/20 sans. Acceptable as a scale, but the 4px status-target gap sits inside a button with no block padding, so the two lines look pinned to the top on a 60px max header. | Fixed block padding 6px; centre the stack (B.2.1).
P-06 | MEDIUM | More panel | Panel keys are fixed 44px and wrap at 7 per row with a ragged ~26px right gap (841a7cbf), unlike a keyboard. | Grid with flexible columns filling the width (B.2.4).
P-07 | MEDIUM | Settings | `.settings-dialog__body h3` has no font-size, so it falls to the browser default 1.17em of 14px (about 16.4px), off the type scale; all body children share one 12px gap, so section headings sit as close to the previous field as fields sit to each other. SUSPECTED visually (no device capture of Settings); CSS verified. | B.2.5.
P-08 | MEDIUM | Standalone | No manifest, no apple-touch-icon, no web app title. On iOS 26 every Home Screen site opens as a web app by default, so the gap is icon, name, and colours, not the mode itself. | B.3.
P-09 | MEDIUM | Standalone, key bar | Key bar bottom padding is `max(6px, env(safe-area-inset-bottom))`. In standalone the bottom inset is non-zero (home indicator); with the keyboard open that padding may become a dead band above the keyboard. SUSPECTED (not tested in standalone). | Collapse to 6px while the software keyboard is open (B.3.4).
P-10 | LOW | Key row | Glyph keys use `1.05rem` (16.8px), off the 4px-grid scale. | 16px (`1rem`).

Already fixed and not re-specified: Enter 4th in default order, 4px status-target gap, 8px block padding on Open terminals rows, floating Select text pill removed.

### B.2 Exact values (phone, inside `@media (max-width: 719px)` unless noted)

Phone type scale (existing tokens only):

| Role | Family | Size/line | Weight | Colour |
| --- | --- | --- | --- | --- |
| Status (`Connected`) | Sans | 12/16 (`--text-meta`) | 500 | `--text-muted` |
| Target (header and panel) | Mono | 13/18 (`--text-secondary`) | 400 | `--text` in header, `--text-muted` in panel rows |
| Toolbar controls (`Actions`, `Close`) | Sans | 14/20 (`--text-body`) | 500 | `--text-muted` |
| Panel heading (`Open terminals`) | Sans | 14/20 | 600 | `--text` |
| Panel row host | Sans | 14/20 | 600 selected, 500 other | `--text` / `--text-muted` |
| Key faces | Mono | 13/1 text, 16/1 glyph | 400 | `--text` |
| Settings sheet title | Sans | 18/24 | 600 | `--text` |
| Settings section (`h3`) | Sans | 14/20 | 600 | `--text` |

Phone spacing rule: chrome text starts 12px from the screen edge (plus safe-area); key boxes start 8px from the edge; the terminal keeps its 6px cell padding (unchanged; it is cell space, not chrome).

#### B.2.1 Header

```
| 12 | Connected                         v | 8 | [... Actions] | 12 |
|    | mark@192.168.64.3:22                  |   |               |    |
  6px top/bottom padding, min 44px, max 60px, plus safe-area-inset-top
```

- `.app-shell--session .app-toolbar`: `padding-inline: max(12px, env(safe-area-inset-left)) max(12px, env(safe-area-inset-right))`; `gap: 8px`.
- `.app-shell--session .session-identity--switcher`: `padding: 6px 0` (raise specificity or order it after the generic `.app-shell--session .session-identity` phone rule, which currently re-adds `padding-left: 12px`); `row-gap: 4px`; `align-content: center`; `color: var(--text-muted)` (fixes P-02 for the chevron).
- Chevron: 18px (default icon size), `stroke-width 2`, `--text-muted`; `--text` while `aria-expanded="true"`.
- Hit area unchanged: whole switcher button, min 44px tall.

#### B.2.2 Open terminals panel

- Position unchanged: `left/right max(8px, safe-area)`, `top` below header.
- Panel `padding: 4px`. Heading row: `min-height: 44px`, `padding-left: 8px` (text at 12px from panel border), `Close` button 44px min.
- Row (`[role="tab"]`): `padding: 8px 8px` (block padding already 8px, committed); stack: host 14/20, target mono 13/18 muted, state 12/16 muted, `row-gap: 2px`.
- Active row underline: keep 2px `--accent` inset at the item's bottom; the committed 8px padding keeps it off the state text.
- `New terminal`: 44px, `padding-inline: 8px`, `--accent` text and `Plus` icon, 8px icon-label gap.

#### B.2.3 Key row (P-01)

Measured at 390px: bar padding 8 + 8, Keyboard 44, More 64, two 4px gaps, keys area 258px; capacity 5; 5 keys at 44 + 4 gaps = 236; remainder 22px.

- `.key-bar__keys .key-bar__key` (the measured keys, not Keyboard or More): `flex: 1 1 44px; width: auto; min-width: 44px; max-width: 56px`.
- Result at 390px: each key `(258 - 16) / 5` = 48.4px; no dead slot; More stays flush right.
- Why 56px cap: capacity floors on a 48px pitch, so with 4 or more keys the per-key remainder is under 12px; 44 + 12 = 56 absorbs it all without stretching keys on wide coarse-pointer screens.
- `KeyBar.tsx` capacity maths stays unchanged (`KEY_WIDTH = 44`, gap 4); it measures `.key-bar__keys` width, which flex-grow of children does not alter, so there is no measure loop.
- At 430px (largest iPhone portrait): keys area 298, capacity 6, keys 46.3px. At 320px: keys area 188, capacity 3, keys 60px capped to 56 with 8px left; acceptable at the minimum width (or set `max-width: 64px` to absorb it; implementer's choice, both pass).
- Glyph faces: `.key-bar__key--glyph { font-size: 1rem; }` (P-10).

#### B.2.4 More panel (P-06)

- `.key-bar-panel`: `display: grid; grid-template-columns: repeat(auto-fill, minmax(44px, 1fr)); gap: 4px;` keep `max-height`, padding, and scroll rules.
- Panel keys: `width: auto; height: 44px`.
- Result at 390px: 7 columns of 50px, flush to both 8px edges.
- Empty-state paragraph: `grid-column: 1 / -1`.

#### B.2.5 Settings sheet (P-07)

- `.settings-dialog__header`: `padding: 12px max(16px, env(safe-area-inset-right)) 12px max(16px, env(safe-area-inset-left))`; title h2 18/24 600; `Close` 44px.
- `.settings-dialog__body h3`: `font-size: var(--text-body); line-height: var(--leading-body); font-weight: 600`.
- `.settings-dialog__body h3:not(:first-child)`: `margin-top: 12px` (with the 12px body gap gives 24px between work areas, matching DESIGN.md).
- Label to control stays 8px (DESIGN.md); field to field stays 12px gap; hints 13/18 muted directly under their control (existing).
- Bottom: body `padding-bottom: max(16px, env(safe-area-inset-bottom))` (existing; correct for standalone).

### B.3 Home Screen standalone mode

Source: WebKit, "News from WWDC25: Web technology coming this fall in Safari 26 beta" (https://webkit.org/blog/16993/, accessed 2026-11-02, scope iOS/iPadOS 26): every site added to the Home Screen opens as a web app by default; users can turn off "Open as Web App"; a manifest's benefits still apply; "If you define your icons in the manifest, they're used". Claims below about status bar style and splash behaviour come from older Apple guidance and were not re-verified against a current Apple page: device-test them.

#### B.3.1 Manifest (`frontend/public/manifest.webmanifest`)

```json
{
  "id": "/",
  "name": "localssh",
  "short_name": "localssh",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#15161E",
  "theme_color": "#1E202B",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

Colours shown for Option A dark (manifest colours take one value, not a media query; dark matches the terminal the app opens into). Swap for B or C dark surface and canvas if chosen. No `description`, `categories`, or shortcuts: copy is frozen and none was requested.

#### B.3.2 `frontend/index.html` additions

```html
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<meta name="apple-mobile-web-app-title" content="localssh" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
```

- Keep existing `viewport-fit=cover` and both `theme-color` metas (update values per chosen palette).
- Status bar: `default`, not `black-translucent`. `black-translucent` draws white status text over the page in both colour schemes, which would be white on the white light-mode toolbar. MED confidence; test both values on the device in light and dark mode before locking.
- `apple-mobile-web-app-capable` is no longer needed for the mode on iOS 26 (WebKit source above). Add it only if iOS 17-18 devices must open full-screen; that is an open question.

#### B.3.3 Icons

- `apple-touch-icon.png` 180x180, `icon-192.png`, `icon-512.png`: opaque square, no pre-rounded corners or transparency (iOS applies its own mask).
- `icon-maskable-512.png`: glyph inside the central 80% safe zone.
- Artwork: derive from `favicon.svg` (`>_` on `#2A2E42`). Whether `>_` is the formal brand mark is an open DESIGN.md item; hand final artwork to a graphic designer. Until then use the favicon geometry scaled, marked placeholder in the build record.

#### B.3.4 Safe areas and keyboard in standalone

- Top: the toolbar already pads `env(safe-area-inset-top)` and the session header caps at `60px + inset`; keep. With status bar `default` the top inset may be 0; both cases are covered by the existing `calc`.
- Bottom, keyboard closed: key bar keeps `max(6px, env(safe-area-inset-bottom))` so keys stay out of the home-indicator zone (Apple HIG convention).
- Bottom, keyboard open (P-09): publish a keyboard-open flag from the existing visual-viewport logic in `viewportHeight.ts` (for example `data-keyboard="open"` on `.app-shell` when `window.innerHeight - visualViewport.height > 120`) and set `.key-bar`, `.key-bar-panel`, `.recovery-row` `padding-bottom: 6px` under it. Verify on device; if the inset already drops to 0 with the keyboard open, skip this.
- Landscape: left/right insets already applied to toolbar, terminal viewport, and key bar; keep.
- Standalone has no Safari back or reload control. Any state whose recovery says to reload the page needs an in-app control. SUSPECTED: not audited here; the featurebuilder should grep help and error copy for "reload" and report.

#### B.3.5 Storage separation (behaviour, not visual)

On iOS, a Home Screen web app has its own storage, separate from Safari. Saved hosts, known host keys, and settings created in Safari will not appear in the Home Screen app, and the reverse. MED confidence (long-standing iOS behaviour, not re-verified for iOS 26 here). This affects the vault and host-key trust. The interface copy is frozen, so the proposal is a Help addition for a writer, plus a device check in step 7.

### B.4 States and motion

- No new motion. Key press: existing `:active` background swap (instant). Reduced motion unaffected.
- Empty/loading/error states for header, panel, key bar, and Settings unchanged; this step changes spacing, type, and colour only.

### B.5 Accessibility notes

- All targets stay at least 44x44 (flex keys only grow). Focus outline 3px `--focus` with 2px offset stays; all three palettes measure at least 5.9:1 for the ring on chrome surfaces.
- Chevron colour change does not affect the accessible name (`Open terminals`, plus target and state in the combined row).
- Hand to an accessibility audit: VoiceOver order in header and panel after padding changes, zoom to 200% on Settings, standalone-mode status bar legibility in both schemes, contrast of the chosen palette's armed/locked modifier keys in real rendering.

---

## Leverage order for the featurebuilder

1. Palette tokens and theme-color metas (one block in `app.css`, two lines in `index.html`).
2. P-02 chevron colour, P-01 flexible keys, P-06 panel grid.
3. P-03/P-05 header insets, P-04 panel target type, P-07 Settings headings, P-10 glyph size.
4. Manifest, icons, head tags; keyboard-open bottom padding after a device check.

## Open questions for the user

1. Which palette: A Iris Slate (recommended), B Graphite Amber, or C Ink Mono?
2. In light OS mode, should the default terminal stay dark Tokyo Night next to white chrome (today's behaviour), or should a light terminal theme become the light-mode default? Not changed in this spec.
3. Home Screen icon: use the `>_` favicon geometry as the icon, or wait for a graphic designer's mark?
4. Must Home Screen mode work full-screen on iOS 17 and 18 too (adds the legacy `apple-mobile-web-app-capable` tag)?
5. Accept that a Home Screen app on iOS has separate saved hosts and known host keys from Safari, with a Help note, or is that a blocker?

## What to validate with real users and devices

- Whether the new palette resolves the dislike (show A and one alternate on the phone, same session).
- Key row with flexible keys at 390px: no missed taps on the wider keys, More still found.
- Standalone: status bar legibility in light and dark, top and bottom insets with keyboard open and closed, rotation, storage separation, recovery without a reload button.

---

## Proposed DESIGN.md changes (diff-style; not applied)

```diff
 ## Tokens

 | Role | Light | Dark | Use |
 | --- | --- | --- | --- |
-| Canvas | `#F6F8F7` | `#151C1E` | App background |
-| Surface | `#FFFFFF` | `#1D2729` | Form, toolbar, dialog, file panel |
-| Surface subtle | `#ECF1F0` | `#263235` | Hover, selected neutral area |
-| Text | `#202A2B` | `#E6EDEF` | Primary copy |
-| Text muted | `#506062` | `#AAB9BB` | Secondary copy and labels |
-| Border decorative | `#D6DFDD` | `#39484B` | Dividers only |
-| Border control | `#788B8D` | `#74888A` | Input outline and control affordance |
-| Accent | `#245D6B` | `#75C1D1` | Primary action, active tab indicator, focus |
-| Accent text | `#FFFFFF` | `#151C1E` | Text on accent |
+| Canvas | `#F6F7FB` | `#15161E` | App background |
+| Surface | `#FFFFFF` | `#1E202B` | Form, toolbar, dialog, file panel |
+| Surface subtle | `#EDEFF6` | `#282B39` | Hover, selected neutral area |
+| Text | `#1E2233` | `#E4E7F2` | Primary copy |
+| Text muted | `#525971` | `#A9AFC7` | Secondary copy and labels |
+| Border decorative | `#D9DCE7` | `#363A4D` | Dividers only |
+| Border control | `#787F99` | `#777E9B` | Input outline and control affordance |
+| Accent | `#3A4FBF` | `#8FA3F7` | Primary action, active tab indicator, focus |
+| Accent hover | `#2E3F9C` | `#ADBCFA` | Hover on accent fill |
+| Accent text | `#FFFFFF` | `#15161E` | Text on accent |
 | Danger | `#A53636` | `#F09994` | Errors and changed host key only |
-| Danger surface | `#FFF1F0` | `#342326` | Error panels |
+| Danger surface | `#FFF1F0` | `#33232B` | Error panels |
 | Success | TBD | TBD | Success feedback only, never decoration |

-- Contrast checks by WCAG relative luminance: light text/canvas 13.79:1, muted/canvas 6.17:1, accent/white 7.36:1, control border/white 3.57:1. Dark text/canvas 14.57:1, muted/canvas 8.52:1, accent/canvas 8.47:1. Dark control border/surface must be checked at implementation because the adjacent surface differs from canvas.
+- Palette "Iris Slate": chrome neutrals take the hue of the default terminal theme (Tokyo Night) so chrome and terminal read as one instrument. The favicon tile `#2A2E42` belongs to the same family.
+- Contrast checks by WCAG relative luminance: light text/canvas 14.73:1, muted/canvas 6.48:1, muted/subtle 6.04:1, accent/white 6.88:1, accent/subtle 5.99:1, control border/white 3.97:1, control border/subtle 3.45:1. Dark text/canvas 14.60:1, muted/subtle 6.45:1, accent/surface 6.75:1, accent/subtle 5.85:1, accent text on accent 7.51:1, control border/surface 4.04:1, control border/subtle 3.51:1, danger/surface 7.47:1.
+- Backdrop: light `rgb(14 15 24 / .56)`, dark `rgb(4 5 10 / .68)`. `theme-color` metas follow Surface.
+- Terminal themes stay independent of chrome tokens; Tokyo Night stays the default.

 ## Layout
+- Phone chrome insets: chrome text starts 12px from the screen edge plus safe area (header, panel content via 4px panel padding plus 8px item padding); key boxes start 8px from the edge; the terminal keeps 6px cell padding.
+- Home Screen web app: `manifest.webmanifest` with `display: standalone`, `start_url` and `scope` `/`, 192, 512, and maskable 512 icons, 180px apple-touch-icon, `apple-mobile-web-app-title` `localssh`, status bar style `default`. Bottom bars keep the safe-area inset with the keyboard closed and drop to 6px while the software keyboard is open.

 ## Components
+- Key bar: measured keys are flexible, `flex: 1 1 44px`, max 56px, so the row has no dead slot before More keys; capacity still counts 44px keys and 4px gaps. Glyph faces 16px. The More keys panel is a grid of `minmax(44px, 1fr)` columns filling the width.
+- Phone session switcher: the chevron uses Text muted (never the platform default button colour); the target uses IBM Plex Mono 13/18 in the header and in Open terminals rows.
+- Settings: section headings 14/20 weight 600 with 24px above each section after the first.

 ## Open items
-- `--terminal-shell` `#1A1B26` in `app.css` is the Tokyo Night background used for the terminal frame and padding. ... Decide whether the frame follows the selected terminal theme.
+- `--terminal-shell` `#1A1B26` is only the pre-theme first-paint stand-in; `.terminal-host` already paints the selected theme's background (closed).
+- Light OS mode pairs white chrome with the dark default terminal. Decide whether light mode gets a light default terminal theme.
+- Home Screen icon artwork pending brand-mark decision on `>_`.
+- iOS Home Screen web apps keep storage separate from Safari (saved hosts, known host keys). Needs a Help note from a writer and a device check.
```

The existing `Phone touch` line stays unchanged; the three Components lines above are additions.
