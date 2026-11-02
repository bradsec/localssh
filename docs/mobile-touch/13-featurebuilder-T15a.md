# T15a report: key model, order, new keys, modifiers as items

## Built
- `TerminalKey` gains `modifier?` and `action?`. `KEY_BAR_KEYS` is now the catalog of 22 keys: ctrl and alt as items, new `shift-tab` (`ESC [ Z`, spoken "Shift Tab"), `text-smaller` ("A-"), `text-larger` ("A+").
- `DEFAULT_KEY_ORDER` follows 10 K-02. `resolveKeyOrder(ids: unknown)` drops unknown ids, non-strings and duplicates, keeps an empty list, and gives the default for a non-array.
- Settings: `keyBarKeys: string[]` (default K-02 order), resolved on load. `FONT_SIZE_MIN/MAX` (8/32) are now exported constants in `settingsStore.ts`, reused by the store, KeyBar and App.
- `KeyBar` takes `keys` and `fontSize`; it renders keys in the given order (Keyboard stays first). Modifier items keep once/locked/off classes and `aria-pressed`. Text keys are `aria-disabled` at 8 or 32. Pointer-up activation and click-with-detail-0 are kept.
- `App.tsx`: `keyBarKeys` memo from settings; `sendKey` handles `action` keys by changing `fontSize` by 1 within 8 to 32, persisting through `updateTerminalSettings`, and announcing via the existing live region: `Text size N px.`, `Text size 32 px, the largest.`, `Text size 8 px, the smallest.` (10 S-22). `updateTerminalSettings` moved above `sendKey` and also updates a `terminalSettingsRef` so rapid taps read current size.

## Files changed
`frontend/src/terminalKeys.ts`, `terminalKeys.test.ts`, `components/KeyBar.tsx`, `storage/settingsStore.ts`, `storage/settingsStore.test.ts`, `App.tsx`, `App.test.tsx`, `e2e/key-bar.spec.ts`. Fixtures/type-only call sites: two `TerminalSettings` literals in `settingsStore.test.ts` gained `keyBarKeys` (type change). No other call sites broke.

## Tests added (written first, seen red)
- terminalKeys: Shift Tab bytes and spoken name; modifiers/text keys as items sending no bytes; default order; `resolveKeyOrder` (default, drop/dedupe, empty).
- settingsStore: default, resolved saved order, empty kept; defaults/round-trip fixtures updated.
- App: Shift Tab sends `ESC [ Z`; saved order lays out keys with ctrl as an item; Ctrl once then locked then off; Text larger to 32 persists, announces, disables, and Text smaller re-enables; smallest announcement.
- E2E (webkit, tap): Shift Tab byte check by effect (type `ab`, Tab, Shift Tab, type `X`, row shows `Xb`, since xterm interprets `ESC [ Z` as back-tab); `A+` at 32 is `aria-disabled` and announces the limit.

## Checks (Node 26)
- `rtk npm test`: Test Files 37 passed, Tests 487 passed.
- `rtk npm run build`: passes (tsc -b + vite build; only the existing chunk-size notice).
- `rtk npm run lint`: oxlint, no diagnostics. `rtk npm run format:check`: all files formatted.
- `rtk npm run test:e2e -- e2e/key-bar.spec.ts --browser=webkit --reporter=line`: 7 passed.

## Unverified
- Chromium run of key-bar.spec.ts not run (plan names webkit).
- Visual layout of 22 keys at 390px: still the horizontal scroll row; fit-to-width and More keys are T15b.

## Notes for the lead
- Once, a full `npm test` run showed `FilePanel.test.tsx` "goes up to the parent folder" failing (`Home` vs `tester`); it passed alone and in two later full runs. Not in my write set; looks flaky (SUSPECTED, not investigated).
- A relay on port 8787 survived the E2E run twice and blocked the next run (`EADDRINUSE`); I killed it by pid. Other relays on random ports belong to other sessions and were left.
- Assumption: text size step is 1 px, matching the Settings size list (`SettingsDialog.tsx:25`).
- Assumption: key bar editor (T12c) will write `keyBarKeys`; nothing in Settings UI edits it yet.
- The empty-list panel text and K-01..K-06 behavior belong to T15b/T12c.
