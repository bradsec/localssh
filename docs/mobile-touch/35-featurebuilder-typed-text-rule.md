# 35 Featurebuilder: typed-text selection rule

## Spec read

Selection edits apply only to text this app sent on the current command line. The screen must match that text from the recorded input start across autowrapped rows. Selections outside the recorded span send no delete bytes.

## Design

- `terminalTouch.ts` records printable input, plain or bracketed paste without newlines, and DEL. It invalidates the record on other input, compares recorded characters with live xterm cells, and uses recorded character boundaries to count edit bytes.
- `Terminal.tsx` keeps the input marker and record per terminal. Enter, Ctrl+C, Ctrl+D, Ctrl+U, alternate screen, column changes, and idle output reset both. The furthest-cursor marker and blank-cell heuristic are removed.
- `App.tsx` already reports successfully sent bytes through `noteSentInput`; no change was needed there.
- Selection edits, including QuickType targets, use the same recorded-span check. Inserts and paste still fall through to the xterm cursor after an ineligible selection collapses.

## Verification and limits

- The split-write autosuggestion regression checks zero bytes for `eck` and exactly two DELs for `ch`.
- Unit and browser cases cover Tab, ArrowUp, newline paste, typed replacement, wide characters, wrapping, stale frozen rows, resize, alternate screen, and raw key-bar modifier input.
- After navigation or a selection edit that sends arrow bytes, selection editing remains unavailable until a reset. Direct shell editing keys still work.
- The test SSH server echoes bytes. It does not model a fish or zsh line editor, and no physical touch device was exercised.

## Self-review

- SR1 | LOW | `frontend/src/terminalTouch.ts:101` | Edit counts initially came from verified screen cells | Changed to indexes into recorded character boundaries; added a wrapped-boundary unit test.
- No remaining finding. Input reaches the same marker through `App.sendInput`, and QuickType uses the same selection check.

## Notes for the lead

- No branch or commit was created. The worktree remains the lead's existing uncommitted `fix/ios-copy-paste` change.
- The regression test sends suggestion text and cursor-back in separate server writes. It asserts only bytes sent to the session.
- No adjacent code was changed.
