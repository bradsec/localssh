# Redesign step 3: product design review

Mode: change review of `76db54f..HEAD` (commit 7d0614b), then an audit of the surfaces it names. The worktree was clean at 7d0614b. No branch, commit, checkout, or stash was made. Excluded as lockfile/generated: `frontend/package-lock.json`, the 52 PNGs in `docs/redesign/02-after/`.

## 1. Design read

Reading this as: an Operate-mode browser SSH workbench for self-hosting operators on a LAN, calm and exact, leaning toward a plain, instrument-like utility (IBM Plex, petrol accent, cool neutral canvas).

### The user's complaint, answered first

Judged against `docs/redesign/00-user-before.png`.

- "Looks the same": no longer true in structure. The split hero card, the 80px shadow, the `NEW SESSION` eyebrow, the two-line display title, the marketing subtitle, the `Version development` footer, the `>_` tile, and the gap above Saved hosts are gone (`02-after/desktop-*-connect-*.png`). Connect and Saved hosts sit top-aligned in a 7/5 grid, and the page title is 24px instead of a hero. HIGH confidence, from the captures.
- "Bad spacing at the bottom of the connect area": fixed. The form ends 24px under `Connect to server`. Saved hosts no longer floats at the bottom of a stretched column. HIGH, from the captures.
- "Offline LED": removed. The idle connect screen shows no status. Sessions show `Connected`/`Offline`/`Connecting` as text beside the mono target. HIGH, from source (`App.tsx` `connectionLabel`) and the captures.
- "Lucide bundled locally": done. `lucide-react` is pinned to exact `1.59.0` in `frontend/package.json:30` and the lockfile, and the step-2 build had no CDN strings. The builder report still says `^1.66.0`, which is stale. HIGH.
- Would this user still say it reads as AI-made? Probably not. The tells they named are gone, and I found no other category tells: no gradients, glow, eyebrows, pills, lamps, or filler copy. Would they say it reads as generic? Possibly. Two bordered white cards on a grey canvas, each holding a form, is the default admin-form look. The signature idea in DESIGN.md (the SSH target as the fixed point) appears only in the session toolbar. The connect screen fails the competitor test: any web SSH client could ship it unchanged. MED confidence; this is a judgment pass, not user evidence. What would change that within DESIGN.md is recorded as an open item: a read-only mono `username@host:port` line above `Connect to server`, composed from the fields as the user types, in the same style as the session target. The user would then see the connection identity before connecting and keep seeing it after. It needs a copy and screen-reader decision, so I did not build it.

## 2. Findings

Status is checked with `git blame` and the diff against `76db54f`. Escalation triggers come first.

ID | SEVERITY | file:line or page/section | problem | proposed fix | status
--- | --- | --- | --- | --- | ---
R-01 | CRITICAL (trigger: overlap at 320px) | `frontend/src/app.css` phone `.app-shell--session .session-identity` (`align-items: flex-start`, about line 2150 at HEAD) | At 320px the session target `tester@127.0.0.1:45407` ran under the `Actions` button and the two texts overprinted. A flex-start column child takes its text width and ignores `min-width: 0`. Observed in `03-review/session-320-*.png`, first run. | Stretch the column and let the target wrap (`overflow-wrap: anywhere`), so it never truncates or overlaps. | Introduced. Fixed.
R-02 | CRITICAL (trigger: clipped at 320px) | `frontend/src/app.css` `.terminal-settings fieldset`, `.about__panel`, `.clipboard-menu__panel` (`right: 0` on the summary) | On phone connect the Appearance panel opened past the left edge. Its labels and selects were cut off at 320px, observed at x ≈ -96. It is anchored to an icon that sits about 120px from the right edge. | Below 720px, anchor the panels to the toolbar's right edge (`position: static` on the details, `right: 12px` on the panel). | Pre-existing (same anchor at `76db54f:frontend/src/app.css:1409-1415`). Fixed.
R-03 | HIGH (trigger: state by color alone, builder F-02) | `frontend/src/App.tsx` tab strip (around line 512) | An unselected tab whose session dropped looked like a live tab. Its only differences were the muted color it shares with every inactive tab and its accessible name. | Lead decision: Lucide `Unplug` plus visible `Disconnected` text on any dropped tab. Unit test added. Observed in `03-review/tabs-dropped-*.png`. | Introduced (the redesign removed the inverted pill). Fixed.
R-04 | MEDIUM | `frontend/src/components/FilePanel.tsx` Replace file confirmation | `Replace file` overwrites a remote file but looked exactly like `Cancel`. That breaks the DESIGN.md Components rule "Destructive button: danger fill or border only at a destructive decision". | Scoped `.file-panel__danger` with danger fill and danger hover. | Introduced (the button styling is new). Fixed.
R-05 | MEDIUM | Connect screen, desktop and phone (`02-after/desktop-*-connect-*.png`) | The category idea fails the competitor test (see section 1). The connect screen does not express the target-as-fixed-point idea. | DESIGN.md open item: a composed target line above Connect. Needs a copy decision. | Introduced (the redesign scope). Deferred.
R-06 | LOW | `frontend/src/app.css:30` `--terminal-shell: #1a1b26` | The terminal frame and padding use a Tokyo Night literal that is not in the DESIGN.md token table. With a non-default theme such as Solarized Light, the frame stays navy around the terminal. SUSPECTED: not captured with another theme. | Let the frame follow `--terminal-background`, or add the token to DESIGN.md. | Pre-existing. Deferred, recorded in DESIGN.md open items.
R-07 | LOW | Files list (`03-review/files-overwrite-1440-*.png`, `screenshot2.png`) | Folder rows are taller than file rows: the 44px link target plus its kind line. The list rhythm alternates. | Give folder and file rows one row grid (name, kind, and action aligned in the same 2-row cell). | Introduced. Deferred (MEDIUM work in FilePanel layout).
R-08 | LOW | Files transfer row (`03-review/files-transfer-*.png`) | Progress is text only (`Uploading big-…: 6%`). There is no `<progress>` element, so a sighted user gets no bar. | Add a native `<progress>` bound to `busy.percent`. | Pre-existing. Deferred.
R-09 | LOW | `frontend/src/app.css` `.connect-form__auth` | The radio row is 44px for touch targets, so the gap below the radios (about 28px) is larger than the 18px between other fields. | Accept, or pull `Password` up by 8px on pointer devices only. | Introduced. Deferred (it is an accessibility tradeoff).

No finding on: the host-key dialogs (both states keep their wording, the changed key uses danger with both fingerprints, and the phone sheet keeps both actions in view), vault reset (typed `DELETE`, danger button disabled until confirmed, existing recovery copy), the Stop transfer confirmation (not data-destructive: the copy says an unfinished upload does not change the remote file), focus (15 of 16 Tab stops on connect showed `outline: solid 3px`; the 16th is `body` when focus wraps), and 200% zoom (no horizontal overflow at a 720px layout viewport on connect, appearance, session, Actions, or Files).

Removed-line pass on the diff: the deleted `aria-*`, `role`, `focus-visible`, and `tabular-nums` lines all have equivalent replacements in the new markup or CSS (tablist, tab, tabpanel, `aria-live` status, Help nav and results, `:focus-visible` on button, summary, input, select, textarea, a, and `[tabindex]`; `.about__link` is covered by `a:focus-visible`). I found no lost signal.

### Nielsen heuristics (0 to 4)

1. Visibility of system status: 3. The status and target are text, and dropped tabs are now marked (R-03). Transfer progress is text only (R-08).
2. Match with the real world: 4. The copy uses SSH terms (host key, fingerprint, `user@host:port`).
3. User control and freedom: 3. Cancel on host key, replace, and transfer; Keep transferring. A closed tab cannot be reopened, but New terminal reconnects.
4. Consistency and standards: 3. One icon family and one radius rule. R-04 and R-07 were the drifts.
5. Error prevention: 4. Typed `DELETE`, the replace confirmation, and the changed-key warning with `Cancel (recommended)`.
6. Recognition rather than recall: 3. Phone icon-only toolbar buttons have names but no visible labels; the labels sit in the Actions menu during a session.
7. Flexibility and efficiency: 3. Keyboard tab switching and saved hosts. There is no quick-connect from the URL; that is a product scope question.
8. Aesthetic and minimalist design: 3. Clean but generic (R-05).
9. Error recovery: 4. Errors name the cause and link to Learn more, which works from the Actions menu (builder F-01).
10. Help and documentation: 4. Searchable Help with contextual entry points.

### Personas (SUSPECTED until observed with users)

- Power user, desktop: connects from a saved host and works across tabs. Before R-03, they would lose track of a background tab that dropped. Now they see `Disconnected` on the tab. Likely stall: none observed.
- First-time visitor, phone: fills the form and verifies the host key. The fingerprint block wraps and both actions stay visible (`03-review/host-key-changed-390-*.png`). Likely stall: at 320px before R-02, Appearance was unreadable. Saved hosts sits below the form and needs a scroll, which is intended.

## 3. Fixes applied (ID -> files; the lead commits)

- R-01 -> `frontend/src/app.css`, `frontend/e2e/connect-flow.spec.ts` (new test "keeps the session target clear of the Actions button at 320px").
- R-02 -> `frontend/src/app.css`, `frontend/e2e/connect-flow.spec.ts` (new tests "keeps toolbar panels on screen at 320px / 390px").
- R-03 (F-02) -> `frontend/src/App.tsx`, `frontend/src/app.css`, `frontend/src/App.test.tsx` (new test "marks a dropped tab without relying on color while another tab is selected"; it failed first on `getByText("Disconnected")` as expected, then passed), `docs/USER-GUIDE.md`.
- R-04 -> `frontend/src/components/FilePanel.tsx`, `frontend/src/app.css`.
- Lead decisions recorded -> `DESIGN.md`.
- README screenshots -> `screenshot1.png` (connect form, 1440x900, light; recaptured from the final UI and byte-identical to the step-2 file, so git shows no change), `screenshot2.png` (two connected tabs with the SFTP Files pane open, 1440x900, light, against the e2e test server), `README.md:51` alt text updated to match. Line 49's alt text still matches.

## 4. Design system decisions recorded (DESIGN.md)

- Breakpoints: the Actions menu collapses session controls below 1024px. Connect uses two columns from 1024px and one 640px column below. Files is a side pane from 920px.
- No `Connection details` heading; the title sits directly above Host.
- Icons: `lucide-react` pinned to exact `1.59.0`, 18px/stroke 2 via `LucideProvider`, plus a full icon map. Help is `CircleHelp`, About is `Info`; added `X`, `FolderOpen`, `Plus`, and `Unplug`.
- Tabs: a dropped tab shows `Unplug` and `Disconnected` in any selection state.
- Phone toolbar: the target wraps, never truncates or overlaps, and the toolbar may grow by one line at 320px.
- Files: `Replace file` is danger; `Stop and close` is not, with the reason stated.
- Toolbar overlay panels anchor to the toolbar edge below 720px.
- Open items: closed the dark control border check (4.10:1). Added the `--terminal-shell` literal, the connect-screen signature proposal, and Success staying TBD.
- Builder F-03 is left as is, per the lead.

## 5. Verification

Commands run in `frontend/` on Node 26 after the last change:

- `npm test`: `Test Files  29 passed (29)`, `Tests  332 passed (332)`
- `npx tsc -b`: `TypeScript: No errors found`
- `npm run lint`: exit 0; `npx oxlint -f json` gives `"diagnostics": []`
- `npm run format:check`: `All matched files use the correct format.`
- `npm run build`: `✓ built in 187ms`
- `npx playwright test` (project suite, capture spec removed): `25 passed (13.1s)`. Earlier, the full suite plus the temporary capture spec gave `43 passed (50.0s)`.

Captures (Chromium, `reducedMotion: reduce`), saved to `docs/redesign/03-review/`, 44 PNGs plus `probe.json`:

- Changed host key, vault reset, Files overwrite, transfer progress, Stop transfer, and dropped tab: each at 390x844 (touch) and 1440x900, light and dark.
- Connect, Appearance open, session, Actions open, and session Files: each at 320x640 (touch) and at a 200% zoom equivalent (720x450 layout viewport, device scale 2), light and dark.

Probe measurements (`probe.json`, final UI):

- `scrollWidth == clientWidth` on every screen: no horizontal page scroll at 320, 390, 720, or 1440.
- No interactive control outside the viewport except key bar keys and `New terminal`, which sit inside their intended horizontal scroll strips.
- The probe also listed Appearance selects off-screen while the `<details>` is closed. Opened, the panel is fully on screen (`connect-appearance-320-*`: `[]`). The closed-state boxes are not reachable, so these are not findings.

Contrast for pairs I touched (WCAG relative luminance on token values, not on rendered pixels):

- `Disconnected` text is the muted token: light 6.58:1 on surface, dark 7.54:1.
- `Replace file`: light white on `#A53636` 6.60:1, hover 8.77:1. Dark `#2A1414` on `#F09994` 8.02:1, hover 10.03:1.

Sources, accessed 2026-11-01: W3C, WCAG 2.2 Recommendation, 12 December 2024 (https://www.w3.org/TR/WCAG22/): SC 1.4.1 Use of Color, SC 1.4.4 Resize Text ("up to 200 percent"), SC 1.4.10 Reflow ("a width equivalent to 320 CSS pixels"). I could not read SC 2.5.8 in the fetched excerpt. The 44px target rule here comes from DESIGN.md, not from a WCAG claim.

Not verified:

- Physical iOS Safari and Android Chrome. Real browser zoom: the zoom check emulates it with a halved viewport.
- Screen reader output for the new tab text. The tab keeps its `aria-label` (`<host>, disconnected`), so the visible `Disconnected` is not announced twice. Not tested with an actual screen reader.
- Hover states with a real pointer. Lighthouse was not run.
- The new e2e tests for R-01 and R-02 were not run against the pre-fix CSS, because the session rules forbid stash or checkout. The pre-fix overlap and clipping were observed in the first capture run.
- The terminal frame color with non-default themes (R-06).

## 6. Deferred

- R-05: the connect-screen signature line needs a copy and screen-reader decision. It is recorded in DESIGN.md open items.
- R-06: whether the terminal frame should follow the selected theme is a product decision. It is recorded in DESIGN.md.
- R-07: equalizing Files row heights is a FilePanel layout change beyond a small, safe fix.
- R-08: a native progress bar is a small addition, but not CRITICAL or HIGH. It is left for the next pass.
- R-09: the radio row height is an accessibility tradeoff, kept on purpose.
- Builder F-03: left as is, per the lead.
