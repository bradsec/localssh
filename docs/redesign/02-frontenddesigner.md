# Redesign step 2: frontend implementation

Direction: calm, compact operator workbench for self-hosted server users, expressed through IBM Plex Sans UI with IBM Plex Mono for targets and fingerprints, the DESIGN.md petrol palette on a cool neutral canvas, top-aligned connect and vault work areas with no hero, and the session target line (`Connected  user@host:port`) as the signature detail beside the wordmark. Surface mode: Operate. Built within root `DESIGN.md` (locked) and `PRODUCT.md`.

Frozen and preserved: field labels, names and order; Help text and topics; error and recovery language; host-key wording and button labels; security and privacy copy (moved, not removed); the `localssh` wordmark; the GitHub brand mark; system light/dark preference (there is no separate theme toggle; the Appearance control is the terminal theme and is unchanged).

## Changes

Dependency: `lucide-react@^1.66.0` added to `frontend/package.json` and `package-lock.json` with `npm install`. Named imports only. `LucideProvider` in `App.tsx` sets size 18, stroke 2, class `icon` once for the app.

Files:

- `frontend/src/App.tsx`: toolbar rebuilt. `>_` tile and Offline lamp removed. Session identity shows `Connected`/`Offline`/`Connecting` as text plus the mono target; idle connect view shows no status. Below 1024px a session shows one `Actions` button (new `ActionsMenu`) holding Files, Disconnect, Clipboard, Appearance, Help, About with their existing labels. Tab close `×` glyph replaced by Lucide `X` (same accessible name); New terminal gets `Plus`; Files gets `FolderOpen`.
- `frontend/src/components/ActionsMenu.tsx` (new): disclosure button plus panel; closes on outside press, Escape (returns focus to the trigger, yields to an open nested panel or Help), and after Files/Disconnect.
- `frontend/src/components/ConnectDialog.tsx`: removed `New session` eyebrow, two-line hero, marketing subtitle, intro column, `Connection details` heading, and the `Version` footer. Title `Connect to your server` now heads the form. The privacy note (locked, unavailable, saved-password copy) is kept verbatim under the form.
- `frontend/src/components/SavedHosts.tsx`: `Optional` pill removed; `Locked` and host count stay as text status. Icons swapped.
- `frontend/src/components/Help.tsx`: dialog now rendered by `HelpProvider` (root-cause fix, see F-01); title, search, and topic nav stay fixed, one `.help__body` region scrolls.
- `frontend/src/components/KeyBar.tsx`: keyboard cue is Lucide `Keyboard`, plus `ChevronDown` when tapping would dismiss.
- `ClipboardMenu.tsx` (hand-drawn `ClipboardMark` and selection dot removed, Lucide `Clipboard`), `TerminalSettings.tsx` (`Palette`), `About.tsx` (`Info`, GitHub mark kept), `HostKeyPrompt.tsx` (`TriangleAlert`, `KeyRound`).
- Deleted `frontend/src/components/Icon.tsx` and `Icon.test.tsx` (no remaining callers).
- `frontend/src/app.css`: rewritten on DESIGN.md tokens (canvas, surface, surface-subtle, text, text-muted, border, border-control, accent, danger, danger-surface), type scale (24/18/14/13/12, inputs max(16px,1rem)), spacing 4 to 32, radii 6/8, one overlay shadow, 120ms color/border feedback, reduced-motion instant. Removed: lamp keyframes, split card and its 80px shadow, uppercase micro-labels (dialog label, About meta, gesture legend, clipboard fields), `translateY` press, unused `.switch`. Connect: 12-column grid capped at 1120px, form 7 columns and vault 5, top aligned, 24px gap; single 640px column below 1024px; 16px insets below 720px. Terminal frame flush with no bezel. Tabs: 2px accent underline plus weight on the active tab. Files: 360px pane at 920px and up, replaces the terminal below. Host-key dialog 560px, scrolls internally, sticky full-width actions on phone. Hover styles wrapped in `(hover: hover)`; overlays use `overscroll-behavior: contain`; selection and caret use the accent.
- `frontend/index.html`: `theme-color` updated to the toolbar surface (`#ffffff`, `#1d2729`).
- Tests: `App.test.tsx` (version now asserted in About; no Offline on idle connect; keyboard cue asserts Lucide classes and `aria-hidden` instead of the Material viewBox; new narrow-screen Actions test), `Help.test.tsx` (Learn more opens Help with no Help button mounted), `e2e/key-bar.spec.ts` and `e2e/touch-selection.spec.ts` (open Actions before Disconnect/Clipboard at 390px). No assertion was removed or loosened.
- Docs: `README.md` (version location, phone toolbar and Actions, Files and Clipboard location, Lucide licence), `docs/USER-GUIDE.md` (Actions location), `screenshot1.png` and `screenshot2.png` replaced with after captures.
- `docs/redesign/02-after/`: 52 captures (8 before-set screens plus `actions-menu` at phone and tablet, x light/dark x 3 viewports). The temporary capture spec was deleted.

## Spec coverage

ID | status | evidence
--- | --- | ---
A-01 CRITICAL phone toolbar overlap | fixed | `phone-*-terminal-tabs.png`, `phone-*-file-panel.png`: brand, target, Actions do not collide. Also fixed at 768px (`tablet-*`), which overlapped in the before set too.
A-02 dead column, gap above Saved hosts | fixed | `desktop-*-connect-*.png`: both areas top aligned, 24px gutter.
A-03 landing-page intro | fixed | eyebrow, hero, subtitle, split, shadow, version footer removed.
A-04 tile, lamp, pill, dot | fixed | all four removed; status is text.
A-05 phone intro consumes 220px | fixed | `phone-*-connect-absent.png`: title then Host at about 64px below the toolbar.
A-06 inverted tabs | fixed | underline tabs.
A-07 Files grouping | fixed | styled path row, native file button styled, transfer row with Cancel, link-style folders.
A-08 Help scroll | fixed | fixed header and nav, scrolling article column (68ch), phone topic row scrolls sideways with an edge fade.
A-09 host-key eyebrow and top border | fixed | label is sentence case text with icon (wording kept); no top border; sticky actions.
A-10 three icon treatments | fixed | one Lucide family; GitHub mark kept.

## Findings

ID | SEVERITY | file:line or page/section | problem | fix
--- | --- | --- | --- | ---
F-01 | HIGH | `frontend/src/components/Help.tsx` (before: dialog rendered inside the `Help` button component) | Found during e2e: with Help folded into a closed Actions menu, every contextual `Learn more` (Files errors, connection errors, host key) did nothing at narrow widths. | Fixed: `HelpProvider` renders the dialog; focus falls back to the Actions button when the Help button is not mounted. Regression test added.
F-02 | MEDIUM | `frontend/src/App.tsx` tab strip | An inactive tab whose session was lost differs from a live one only in its accessible name; the visible `Offline` status appears only when that tab is active. | Proposal: a visible text or shape cue on lost tabs. Not built: needs a copy decision (SUSPECTED gap, not observed in a capture).
F-03 | LOW | `frontend/src/components/ConnectDialog.tsx` privacy note | In the locked state the note `Saved hosts are locked` repeats the vault's own `Locked` status. Kept because its copy is tested and was not named as ornamental. | Proposal: drop the locked branch of the note once copy owners agree.
F-04 | LOW | `frontend/src/app.css` `.connect-form__auth input` | Radio inputs are 18px; the hit area is the 44px-tall wrapping label. Probe flagged the inputs themselves. | No change needed: label is the target (observed 44px height).

Confidence notes: F-01 HIGH (e2e failure reproduced, then passing after fix). F-02 MED (source reading, not exercised in capture). F-03 HIGH (visible in `tablet-*-connect-locked.png`). F-04 HIGH (probe output).

## Proposals for DESIGN.md (not applied; DESIGN.md is locked)

- P-01: Actions menu for sessions below 1024px, not only below 720px. Evidence: `01-before/tablet-*-file-panel.png` shows the same overlap at 768px; the direct toolbar needs about 640px of controls.
- P-02: Connect uses two columns only at 1024px and up. At 768px the 5-column vault would leave about 230px inputs.
- P-03: Files side pane from 920px (560px terminal plus 360px pane, per DESIGN.md), not the old 700px.
- P-04: Help uses Lucide `CircleHelp` instead of `Info`, so Help and About no longer share one glyph. Extra icons beyond the map: `X` (tab close, replacing the `×` glyph), `FolderOpen` (Files), `ChevronDown` (key bar cue, named in the spec), `CircleHelp`.
- P-05: Record the `Connection details` heading removal; the layout spec places the title directly above Host.
- P-06: `Success` token stays TBD; nothing in this step needed it after the clipboard dot was removed.

## Verification

Commands (Node 26, `frontend/`), observed results:

- `npm test`: `Test Files 29 passed (29)`, `Tests 331 passed (331)`.
- `npx tsc -b`: `TypeScript: No errors found`.
- `npx oxlint`: exit 0, `"diagnostics": []`.
- `npm run format:check`: `All matched files use the correct format.`
- `npm run build`: `built in 211ms` (existing chunk-size warning unchanged in kind).
- `npx playwright test` with the temporary capture spec: `28 passed (18.0s)` (22 project e2e tests plus 6 capture runs). After deleting the spec the project suite is the same 22 tests that passed in that run.

Icons and network: the built bundle contains exactly 16 Lucide icon definitions (chevron-down, circle-question-mark, clipboard, ellipsis, folder-open, info, keyboard, key-round, lock-keyhole, log-out, palette, pencil, plus, trash, triangle-alert, x), so tree-shaking works. No CDN host strings in `dist/assets/index-*.js`. Recorded request origins across all 6 capture runs (every screen, every state): only `http://127.0.0.1:4173` and `ws://127.0.0.1:8787` (relay).

Target sizes (Playwright probe of visible buttons, summaries, inputs, selects, links): at 390, 768, 1440 in both themes, nothing under 44px except the radio inputs (F-04). Key bar keys extending past 390px are the intended horizontal scroll strip.

Contrast (WCAG relative luminance on solid token pairs, computed in Python; not measured on rendered antialiasing): light text/surface 14.71, text/canvas 13.79, muted/surface 6.58, muted/subtle 5.77, accent/surface 7.36, white on accent 7.36, white on accent-hover 9.73, border-control/surface 3.57, border-control/subtle 3.13, danger/danger-surface 6.00, white on danger 6.60. Dark text/canvas 14.57, text/surface 12.90, muted/surface 7.54, muted/subtle 6.52, accent/surface 7.50, text on accent 8.47, text on accent-hover 10.32, border-control `#74888A`/surface `#1D2729` 4.10 (closes the DESIGN.md open item), danger/danger-surface 6.85, dark-danger-text on danger 8.02. All pass 4.5:1 text or 3:1 control boundary.

Before/after comparison (same screens, viewports, themes): phone terminal and Files no longer collide (before: Files/Disconnect drawn over the brand); tablet session toolbar no longer overlaps; desktop connect lost the empty intro column and the 84px gap; phone connect shows Host directly under the title; tabs read as one strip; Files controls are grouped; Help keeps search and topics fixed; host-key prompt has no uppercase eyebrow and full-width phone actions.

Viewports: 390x844 (touch, mobile), 768x1024, 1440x900, light and dark, Chromium, `reducedMotion: reduce`.

## Not verified

- Physical iOS Safari and Android Chrome: keyboard, key bar, Actions menu, safe areas. Next check: X-03 device pass.
- Screen reader and full WCAG 2.2 AA audit, 200% zoom, 320px width captures (the 320px e2e connect test passes). Next check: X-02 audit.
- Changed-host-key dialog, vault reset, transfer progress, and overwrite confirmation were not captured; styles reviewed in source only.
- Font fallback metrics (`size-adjust`) not added; Plex is bundled with `font-display: swap`.
- Hover states in a real pointer session were not screenshotted.
- `lucide-react@1.66.0` was published 2026-10-31, one day before install. If the project wants a release-age floor, pin an older 1.x.
