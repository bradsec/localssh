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
