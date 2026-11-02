# T12c report: key bar section and editor in Settings

## Built
- `KeyBarEditor({ order, capacity, onChange, onBack, onClose })`: sub-view with its own sticky header (Settings back, title "Key bar", Close), intro, "Keyboard always first", rows with Move up, Move down, Remove (44px icon buttons, accessible names per `10` section 6), live divider "Below this line: in More keys on this screen" before row index `capacity` (hidden when capacity is unknown or all keys fit), "Not in key bar" list with Add (appends), "Reset key bar", one `role="status"` line.
- `onChange` returns `{ ok }`; a failed save appends "Could not save on this device." to the status.
- Focus: after a move, focus stays on the same control of the moved row. End buttons are `aria-disabled` and stay focusable; clicks are ignored.
- `SettingsDialog`: new optional props `touchPointer` and `keyBarCapacity`. On a coarse pointer a "Key bar" section (intro plus "Edit key bar") swaps the dialog contents to the editor; Settings back returns and focuses "Edit key bar". Orders persist through the existing `onChange` and `saveTerminalSettings` (`keyBarKeys`). No section on a fine pointer.
- `App.tsx`: passes `touchPointer` and the measured capacity (`KeyBar onCapacityChange`, not wired before T12c).
- `app.css`: `.key-editor__*` rules.

## Files changed
`frontend/src/components/KeyBarEditor.tsx` (new), `KeyBarEditor.test.tsx` (new), `SettingsDialog.tsx`, `SettingsDialog.test.tsx`, `frontend/src/App.tsx`, `frontend/src/app.css`. No fixtures or mocks outside these; the `SettingsDialog` test harness gained the two optional props.

## Tests added (red first: module missing)
KeyBarEditor: move down with focus and announcement; move up with spoken names; aria-disabled end buttons inert and focusable (including a key moved to the end); remove then add back with focus and announcements; removing the last key keeps focus in the editor; reset; divider position and none when all fit; Settings/Close wiring; save failure status. SettingsDialog: no section on fine pointer; coarse pointer edit, persist, return focus, reset.

## Checks (Node 26)
- `rtk npm test -- src/components/KeyBarEditor.test.tsx src/components/SettingsDialog.test.tsx`: Test Files 2 passed, Tests 20 passed.
- Full `rtk npm test`: Test Files 38 passed, Tests 504 passed.
- `rtk npm run build`: passes (existing chunk-size notice). `rtk npm run lint`: no output errors. `rtk npm run format:check`: all files formatted.

## Unverified
- Not run in a browser or E2E; no iOS/VoiceOver check; divider with a real measured capacity only unit-tested via the prop.
- No App-level test for the capacity pass-through.

## Notes for the lead
- Assumptions: after Remove, focus goes to the next row's Remove (else previous, else the Settings back button); after Add or Reset, to the new row's (or first row's) Remove button. `10` does not specify.
- Remove and Add use X and Plus icons with the spec'd accessible names, not visible text.
- The editor owns the `settings-title` id while open; the focus trap now tests `activeElement.id === "settings-title"` instead of the title ref.
- The divider hides when capacity is undefined (bar not measured, or never mounted).
- Capacity is stale while no key bar is mounted (tab without a handle).
