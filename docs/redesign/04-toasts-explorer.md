# Toasts and file explorer

## What changed

- Added a four-item notification stack below the toolbar. Success, information, warnings, and errors use Lucide icons. Hover and focus pause dismissal. Errors last 5 seconds; other messages last 3.5 seconds. Reduced motion removes the leave animation.
- Routed transfer, listing-cap, clipboard, address-book, saved-host, and session outcomes to toasts. Transfer progress and confirmation decisions remain in place.
- Rebuilt Files with breadcrumbs, a collapsible path field, Up, Refresh, Upload, sorting, row selection, keyboard navigation, drop upload, loading skeletons, retry, and a per-tab Expand toggle.
- Added SFTP modification time and rwx permissions to Go listings and the browser engine type. The table uses local time and human-readable sizes.
- Updated README, user guide, and the Files Help topic. Preserved overwrite confirmation, safe-name display, download cap, and close-during-transfer protection.

## Files

Core: `frontend/src/components/Toasts.tsx`, `frontend/src/components/FilePanel.tsx`, `frontend/src/fileExplorer.ts`, `frontend/src/App.tsx`, `frontend/src/components/ClipboardMenu.tsx`, `frontend/src/components/SavedHosts.tsx`, `frontend/src/ssh/engine.ts`, `frontend/src/app.css`, `engine/remotefiles/remotefiles.go`, `engine/sftpjs.go`.

Tests: `frontend/src/components/Toasts.test.tsx`, `frontend/src/components/FilePanel.test.tsx`, `frontend/src/fileExplorer.test.ts`, `frontend/e2e/connect-flow.spec.ts`, `engine/remotefiles/remotefiles_test.go`, and existing affected component tests.

Docs: `README.md`, `docs/USER-GUIDE.md`, `frontend/src/helpTopics.ts`. Twelve after captures are in [`04-toasts-explorer/`](04-toasts-explorer/): 1440×900 and 390×844, light and dark, side, expanded, and toast states.

## Checks

- `engine: go test ./...`: 102 passed in 5 packages.
- `engine: GOOS=js GOARCH=wasm go vet ./...`: passed.
- `engine: ./build.sh`: built WASM engine, runtime script, and test SSH server.
- `frontend: npm test`: 31 files, 346 tests passed.
- `frontend: npx tsc -b`: passed.
- `frontend: npm run lint`: passed with one Fast Refresh warning for the requested shared provider and hook file.
- `frontend: npm run format:check`: passed after `npm run format`.
- `frontend: npm run build`: passed. Vite reported its existing 500 kB chunk warning.
- `frontend: npx playwright test`: 25 passed, including upload toast, size sort, and breadcrumb navigation.

## Anything not done

- No physical phone or screen reader audit. Screenshots and browser tests use Chromium.

## Notes for the lead

- No commits were made. The temporary screenshot capture spec was removed.
- The desktop side view shows Name and Size at 360px. Expand shows Modified and Permissions. Phones show Name and Size, with a visible download action in each file row.

## Compact explorer follow-up

User feedback: Files took too much room, and long folders were hard to navigate.

### What changed

- Density: on a fine pointer, rows and panel controls are 32px. Under `@media (pointer: coarse)` they stay 44px. `FilePanel` reads `(pointer: coarse)` through `useSyncExternalStore` and sets `--file-row` on the panel, so CSS and the virtualization use the same row height. Header, breadcrumb, toolbar, and filter now use 8px gaps and 12px panel padding.
- Fixed chrome: the breadcrumbs, toolbar, filter, and column header stay in place. Only `tbody` scrolls, with `overscroll-behavior: contain`. The page does not scroll.
- Filter: a search field labelled `Filter files` with the Lucide `Search` icon. It matches displayed names without regard to case. A polite status beside it shows `N items` or `12 of 2,000 items`. Clearing the filter restores the full list and the selected item. Opening another folder clears the filter.
- Virtualization: the list is hand-written, with no new dependency. It renders the rows in view plus 8 overscan rows on each side, positioned at `index x row height`. The tab-stop row stays rendered when scrolled away, so Tab still reaches the list.
- Semantics: the table is `role="grid"` with `aria-rowcount` (shown rows plus the header) and `aria-rowindex` on every rendered row. The header row is 1. Rows carry `aria-selected`. Following the APG grid pattern, focus moves to a cell (the name cell) and not to the row. Arrow keys, Home, End, PageUp, PageDown, Enter, and Backspace or Alt+Up work across virtualized rows and scroll the selected row into view.
- `useToast` and the toast context moved to `frontend/src/toast.ts`. `Toasts.tsx` now exports only `ToastProvider`, and the `react(only-export-components)` warning is gone.
- Side pane stays 360px. Expand still gives the full table, and the toolbar Files toggle or **Close files** collapses it. The old bottom status line is gone: transfer results arrive as toasts, and only the in-progress transfer row and **Save download** link remain in the panel.

### Measurements (Chromium, real relay and test SSH server)

Chrome means panel top to the first list row, including the column header.

| Viewport | Before | After |
| --- | --- | --- |
| 1440x900, fine pointer | 283.5px, 45px rows, about 11 rows visible | 208px with the new filter row, 32px rows, about 18 rows visible |
| 390x844, fine pointer | 283.5px, 45px rows | 208px, 32px rows |
| 390x844, coarse pointer (touch emulation) | not measured | 268px, 44px rows |

Terminal width beside the 360px panel: 1080px at 1440 and 664px at 1024, which keeps the 560px minimum. With 10,000 entries in headless Chromium, 80 wheel steps gave a frame time of 16.7ms median and 16.8ms max. The DOM held 34 rows, and the page scroll stayed at 0.

### Tests

- Vitest (`FilePanel.test.tsx`): the filter narrows the list and shows the count. Clearing the filter restores the selection. With 2,000 entries, the list renders fewer than 60 rows, `aria-rowcount` is 2001, and End, ArrowUp, Home, PageDown, and PageUp move and focus across virtualized rows. Rows are 32px on a fine pointer and 44px on a coarse one. `fileExplorer.test.ts` covers `filterEntries`.
- The existing arrow-key test now focuses the name cell instead of the row, because focus moved to the cell. Its assertions are unchanged.
- Playwright (`connect-flow.spec.ts`): a 2,000-file folder is filtered and cleared. The test keyboards to the last row, which is selected, focused, and in view. The list's `scrollTop` exceeds 50,000 while `document.scrollingElement.scrollTop` stays 0, including under mouse-wheel scrolling. In a 10,050-file folder, the truncation note and toast show and End reaches row 10,001. Each test creates its folder under the served SFTP root after the upload test has checked that the root starts empty. Creating them in global setup would break that check.

### Captures

The 12 captures in [`04-toasts-explorer/`](04-toasts-explorer/) were retaken, along with `1440-light-filtered.png` and `390-light-filtered.png`, which show 100 of 2,000 items. `screenshot2.png` shows the compact explorer beside two tabs. The temporary capture and measurement specs were removed.

### Notes

- DESIGN.md requires 44px hit regions for all controls. Panel controls and rows are 32px on fine pointers only, which is above the 24px WCAG 2.5.8 minimum. DESIGN.md was not edited. The lead should record this exception or reject it.
- Grid navigation is row-wise: only the name cell is focusable, and there is no Left or Right movement between cells. Home and End move to the first and last row, as requested, where APG data grids use Ctrl+Home and Ctrl+End for that. The per-row download button is in the tab order only for the active row.
- No screen reader or physical device check was run.
