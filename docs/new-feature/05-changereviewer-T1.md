# T1 change review

## Change and scope

Base `224b46645c92f92e1f45bfd49c66ef31e9dc55de` (`BASE_T1` in `04-featurebuilder-T1.md`); head `05d28db` on `review/2026-10-31`. One commit changes 12 files, with 928 additions and 149 deletions. The working tree was clean before review.

Change: add multiple live terminal tabs so a user can switch shells without ending other SSH sessions. Intent is stated in `01-featurescout.md:130-150` and `04-featurebuilder-T1.md`. Public APIs, relay protocol, configuration, and stored data formats are unchanged. The diff exceeds 800 changed lines, so review prioritized hand-written App lifecycle and SSH keepalive logic. CSS, prose, and new tests received a focused pass.

Verdict: **CHANGES REQUIRED** (F1, F2). Confidence **HIGH**: both failures follow direct UI and state paths; timing in F1 needs a regression test.

## Findings

F1 | HIGH | `frontend/src/App.tsx:295` | Host-key retry recreates a tab after its pending tab is closed: `trustAndRetry` awaits storage, then passes an absent tab to `attemptConnect`, whose `retryTab ??` path creates a new tab at `frontend/src/App.tsx:201-212` | Trigger: click Trust and connect, return to an open terminal, close the pending tab before `trustHostKey` resolves; `closeTab` removes it at `frontend/src/App.tsx:323` | Check that the original tab still exists after the await; if closed, stop and clear pending key material instead of calling `attemptConnect` | CONFIDENCE HIGH

F2 | HIGH | `frontend/src/App.tsx:349` | Shortcut selects a connecting tab by ID, while click and tab-arrow paths translate that tab to the connect or host-key screen at `frontend/src/App.tsx:414,424`; a truthy `activeTab` hides the host-key prompt at `frontend/src/App.tsx:554` | Trigger: after Return to open terminal during another tab's host-key check, press Ctrl+Alt+Shift+Right toward the pending tab; the page shows an empty terminal instead of the warning | Route all tab selection paths through the same connecting-tab handling, then test the shortcut with a pending host-key prompt | CONFIDENCE HIGH

Both fixes belong with the T1 change author or debugengineer. No whole-repo finding was established.

## Trace and checks

Checked `App` tab selection, connect, close, host-key retry, output, resize, page cleanup, and their `ConnectDialog`, `Terminal`, `HostKeyPrompt`, `connectSession`, and WASM bridge paths. Checked sibling clean close, connection loss, failed connection, and key-authentication paths. Checked `Session.Close`, `RequestPTY`, and global keepalive request paths. The new tests do not cover F1's pending-storage cancellation or F2's shortcut to a pending tab. The browser suite covers two established tabs.

Project commands come from `frontend/package.json`, `relay/package.json`, and `engine/build.sh`. Node 26 was selected for npm commands. Verbatim check summaries:

```text
Go test: 84 passed in 4 packages
built dist/engine.wasm, dist/wasm_exec.js, dist/testsshd
Test Files  29 passed (29)
Tests  306 passed (306)
Test Files  4 passed (4)
Tests  47 passed (47)
All matched files use the correct format.
Finished in 10ms on 84 files using 24 threads.
All matched files use the correct format.
Finished in 6ms on 12 files using 24 threads.
✓ built in 576ms
21 passed (7.8s)
added 124 packages, and audited 125 packages in 933ms
added 49 packages, and audited 50 packages in 673ms
TypeScript: No errors found
```

`GOOS=js GOARCH=wasm go vet ./...`, both lints, relay build, and `git diff --check BASE_T1..HEAD` exited 0 without diagnostics. Frontend build passed with an existing chunk-size warning. An initial `npx tsc -b` overlapped `npm ci` and failed with `TS2688: Cannot find type definition file for 'vite/client'`; the sequential rerun produced `TypeScript: No errors found`.

Not verified: F1's exact timing in a browser; no proof test was applied because this role is read-only for source. Physical phone keyboard, screen reader, silent Wi-Fi loss, Docker build, and a real relay `MAX_SESSIONS` rejection were not run. The pinned `golang.org/x/crypto/ssh` v0.58.0 `Conn.SendRequest` contract was checked against the [official package documentation](https://pkg.go.dev/golang.org/x/crypto@v0.58.0/ssh), accessed 2026-11-01, scope v0.58.0.
