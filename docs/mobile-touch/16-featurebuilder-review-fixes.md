# Phase 2 review fixes

Building: safe mobile session recovery for browser SSH users, done means F1–F8 regressions pass and the project gates stay green. The accepted uncommitted worktree was preserved. No commit was made.

| Finding | Failing regression | Root cause and fix | Files | Confidence |
| --- | --- | --- | --- | --- |
| F1 | Three edited-entry cases failed: `expected "vi.fn()" to be called once, but got 2 times`. | Reconnect matched only entry ID and password presence. Require the unlocked saved entry's host, port, and username to match the tab; otherwise open its prefilled form. | `frontend/src/App.tsx:642`, `frontend/src/App.test.tsx:329` | HIGH, host, port, and username cases passed. |
| F2 | Idle handshake test failed: `AssertionError: expected 101 to be 503`. | Resume bypassed the handshake cap. Count WebSockets awaiting their first frame against `maxSessions`, releasing the slot on first frame or close. | `relay/src/local-relay.ts:222`, `relay/src/local-relay.test.ts:813` | HIGH, pressure test and existing detached-session tests passed. |
| F3 | Blocked-close test failed: `session close blocked before transport close`. | SSH channel shutdown wrote into the detached transport before transport close. Close the transport before the SSH channel. | `engine/sshclient/client.go:326`, `engine/sshclient/client_test.go:34` | MED, the test models a blocked channel close; a real full WebSocket buffer was not exercised. |
| F4 | Rotation e2e failed: `Expected: 21 frames`, `Received: 22`. | Gesture policy captured phone width at mount. Read the current media query for each gesture. | `frontend/src/components/Terminal.tsx:276`, `frontend/e2e/key-bar.spec.ts:315` | HIGH, live landscape-to-portrait e2e passed. |
| F5 | Overlapping-save test failed: `expect(element).toBeDisabled()`. | Appearance selectors accepted a second host save while the vault was busy. Disable dependent selectors until the first save settles. | `frontend/src/components/SettingsDialog.tsx:63`, `frontend/src/components/SettingsDialog.test.tsx:172` | HIGH, the pending and subsequent saves passed. |
| F6 | Two-record test failed: `Unable to find an element with the text: /older.tar.gz stopped at/`. | The stored-record lookup ran only on mount. Refresh it after a download completes or a stopped record is discarded. | `frontend/src/components/FilePanel.tsx:341`, `frontend/src/components/FilePanel.test.tsx:1210` | HIGH, dismissal and completion both reveal the older record. |
| F7 | Two-panel test failed: `expected "vi.fn()" to be called 2 times, but got 0 times`. | Each page could write the same record and segments. Acquire an exclusive Web Lock for Resume, Retry, and Dismiss; retain it through transfer and finished-link release. | `frontend/src/components/FilePanel.tsx:641`, `frontend/src/components/FilePanel.test.tsx:980` | MED, two panels share a simulated cross-page lock; separate browser processes were not exercised. |
| F8 | Unknown-field test failed: `vaultUpsert error = <nil>, want unknown terminal preference`. | The nested terminal object bypassed strict JSON decoding. Decode it separately with `DisallowUnknownFields` and an EOF check. | `engine/vaultjs.go:172`, `engine/vaultjs_test.go:11` | HIGH, the malformed request now fails and Go tests pass. |

## Checks

Commands used Node 26 at `~/.nvm/versions/node/v26.13.0/bin` and the `rtk` prefix. These are verbatim summary lines; commands with no summary exited 0.

```text
frontend: npm test
 Test Files  39 passed (39)
      Tests  530 passed (530)
frontend: tsc -b
exit 0
frontend: npm run lint
> oxlint
exit 0
frontend: npm run format:check
All matched files use the correct format.
frontend: npm run test:e2e
  48 passed (1.5m)

relay: npm test
 Test Files  7 passed (7)
      Tests  185 passed (185)
relay: npm run build
> tsc -p tsconfig.build.json
relay: npm run lint
> oxlint src scripts test
relay: npm run format:check
All matched files use the correct format.

engine: go test ./...
Go test: 126 passed in 5 packages
engine: GOOS=js GOARCH=wasm go build
exit 0
git diff --check HEAD
exit 0
```

Focused checks: F1's three cases passed; F4's e2e passed with `1 passed (5.6s)`; F2's relay test passed; F3 and F8's Go tests passed; F6 and F7's FilePanel tests passed. After full e2e, `pgrep -x testsshd` and `pgrep -f '^node .*scripts/run-local-relay.ts'` each exited 1 with no output.

## Notes for the lead

- F7 uses the browser's Web Locks API. The [W3C Web Locks specification](https://www.w3.org/TR/web-locks/) defines exclusive same-name locks, `ifAvailable` returning `null` on contention, and release after the callback promise settles. Accessed 2026-11-02; scope: Web Locks API specification. Resume, Retry, and Dismiss fail closed when the API is absent.
- F3 still needs a real detached, full-buffer disconnect run. F7 still needs a real two-browser-tab OPFS run. Physical iOS and Android behavior was not checked.
- No adjacent code was changed. The e2e runner emitted `{ before: 19, after: 21, reselected: 21 }` during `font-metrics.spec.ts`; this debug output is an observed adjacent issue.
