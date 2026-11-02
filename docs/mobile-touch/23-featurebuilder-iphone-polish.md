# Step 23: iPhone polish build record (featurebuilder)

Building: Iris Slate palette, iPhone polish (Part B), and Home Screen app mode for localssh users on iPhone Safari. Done means: tokens replaced, key row has no dead slot, manifest and icons served, checks green.

## Files changed

- `frontend/src/app.css`: Iris Slate tokens (light, dark, backdrop); flexible key row; More panel grid; glyph 16px; phone header insets and switcher; Open terminals type; Settings headings; keyboard-open padding rule.
- `frontend/index.html`: manifest link, apple-touch-icon, apple-mobile-web-app-capable/title/status-bar-style, dark theme-color `#1e202b` (light stays `#ffffff`).
- `frontend/public/manifest.webmanifest`, `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`: new. Icons are opaque RGB, rendered with Inkscape from the favicon geometry (full-bleed `#2a2e42`; maskable scales the glyph to 80%). Placeholder until the brand mark is decided.
- `frontend/src/viewportHeight.ts` (+ test): sets `data-keyboard="open"` on the root when `innerHeight - visualViewport.height > 120`.
- `frontend/src/helpTopics.ts`, `README.md`: Home Screen storage note (Help "Saved hosts" topic; README "Home Screen app" section), phrased with "as far as we know".
- `relay/src/web-server.ts` (+ test): content types `.png` -> `image/png`, `.webmanifest` -> `application/manifest+json`. Without this the all-in-one image served both as `application/octet-stream` (nosniff).
- `DESIGN.md`: proposed changes applied.
- `frontend/e2e/iphone-polish.spec.ts`: new.

## Spec coverage

| Requirement | Where | Test |
| --- | --- | --- |
| A.4 tokens, backdrop, theme-color | app.css, index.html | iphone-polish: built CSS has no old hex, has new; theme-color metas |
| P-01 key fill | `.key-bar__keys .key-bar__key` flex 1 1 44px, max 64px | iphone-polish 390 and 320 |
| P-02 chevron colour | switcher `color: var(--text-muted)`, `--text` when expanded | none (visual) |
| P-03/05 header insets | toolbar padding-inline 12px, gap 8; switcher padding 6px 0, row-gap 4, align-content center | existing key-bar spec |
| P-04 panel target mono 13/18, row type | `.terminal-tabs--switcher` rules | existing key-bar spec (spacing) |
| P-06 More grid | `.key-bar-panel` grid minmax(44px,1fr) | existing "opens More keys" 320/390 |
| P-07 Settings h3 | phone media | none (visual) |
| P-09 keyboard-open padding | data-keyboard + CSS | viewportHeight unit test; device check needed |
| P-10 glyph 16px | app.css | none |
| B.3 manifest, icons, meta | public/, index.html | iphone-polish: JSON, icons 200 and image/png |
| Content types in all-in-one | web-server.ts | web-server.test.ts |
| Storage note, DESIGN.md | helpTopics.ts, README, DESIGN.md | helpTopics tests pass |

## Checks

- `npm test`: 40 files, 540 passed.
- `npx tsc -b`: No errors found.
- `npx oxlint`: exit 0.
- `npm run format:check`: All matched files use the correct format.
- relay `vitest run src/web-server.test.ts`: 3 passed.
- Chromium `npx playwright test`: 65 passed.
- WebKit touch-selection: 14 passed. WebKit iphone-polish + key-bar: 17 passed.
- No leftover relay or testsshd processes.

## Decisions and deviations

- Key max-width is 64px, not 56px: the spec lists 64 as the allowed choice and it absorbs the 320px remainder (3 keys of 60px). DESIGN.md records 64.
- Keyboard-open flag goes on `:root` (documentElement), not `.app-shell`, because viewportHeight.ts already owns the root.
- Added `apple-mobile-web-app-capable` per user decision 3.
- Settings and switcher rules are inside the phone media query; key row and panel grid rules are global (key bar shows on tablets too).
- Not touched: terminalThemes, terminalTouch.ts, Terminal.tsx, `.terminal-host--touch`.

## Check on the iPhone

- Chevron is muted, not blue; header text aligns with Open terminals text at 12px.
- Key row at 390px: 5 keys with no gap before More; More keys panel is 7 even columns.
- Add to Home Screen: icon, name "localssh", status bar style `default` legible in light and dark; safe areas.
- With the keyboard open, no dead band under the key bar (the 120px threshold and the standalone inset are untested on device).
- Saved hosts and host keys do not carry between Safari and the Home Screen app (the Help note asserts this with hedging).
- Dark accent `#8FA3F7` vs Tokyo Night blue in the terminal.

## Notes for the lead

- Icons are the favicon geometry, a placeholder; brand mark still open.
- DESIGN.md line "Dark control border `#74888A` on surface `#1D2729` ... (closed)" still carries old hex as history; left as is.
- grep found no help or error copy telling the user to reload the page (B.3.4 audit); `README` mentions "without reloading the page" for vault lock only.
- Manifest colours are a single dark value; in light mode the launch screen background is dark.
- `main.tsx` and `touchDebug.ts` were not touched by this step.
