# T1 feature builder report

BASE_T1: `224b46645c92f92e1f45bfd49c66ef31e9dc55de`

## 1. Spec read and assumptions

Building: multiple live SSH terminal tabs for a browser user, done means two shells retain separate input, output, size, and lifecycle while the user switches between them.

- Tab limit: the spec says TBD. Assumption: no new client limit; the relay's existing `MAX_SESSIONS` limit applies.
- Keyboard shortcut: no binding specified. Assumption: Ctrl+Alt+Shift+Left/Right avoids ordinary terminal input. Tab buttons also support Left/Right.
- Keepalive timing: no interval or miss count specified. Assumption: send a global SSH request every 15 seconds; close after three missed replies, about 60 seconds after idle.
- A browser WebSocket handshake exposes no response status to page JavaScript. Assumption: keep the existing error's explicit session-limit cause and `MAX_SESSIONS` recovery step without claiming that every failed handshake hit the limit. [MDN WebSocket error event, generic `Event`](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/error_event), accessed 2026-11-01, browser WebSocket API.

## 2. Coverage and files changed

| Requirement | ID to files changed | Test |
| --- | --- | --- |
| Open another host without ending shells; each tab has its own handle, xterm, label, status, and size | T1-01: `frontend/src/App.tsx`, `frontend/src/app.css` | `frontend/src/App.test.tsx:131,208`; `frontend/e2e/connect-flow.spec.ts:75` |
| Input, touch key bar, gestures, clipboard, resize, and close target the active tab; tab bar works on phone and keyboard | T1-02: `frontend/src/App.tsx`, `frontend/src/app.css` | `frontend/src/App.test.tsx:155,208`; `frontend/e2e/connect-flow.spec.ts:75` |
| Page close ends every handle; dropped, failed, and late sessions do not close siblings | T1-03: `frontend/src/App.tsx` | `frontend/src/App.test.tsx:188,230,247,288,313` |
| Host-key prompt names its target and allows a return to an existing shell | T1-04: `frontend/src/App.tsx`, `frontend/src/components/HostKeyPrompt.tsx` | `frontend/src/App.test.tsx:262` |
| Relay session-limit recovery remains visible | T1-05: `frontend/src/App.tsx`, reused `frontend/src/connectionErrors.ts` | `frontend/src/App.test.tsx:230` |
| SSH keepalives close silent losses through the existing connection-lost path | T1-06: `engine/sshclient/client.go`, `engine/sshclient/keepalive_test.go` | `engine/sshclient/keepalive_test.go:44,60`; existing `frontend/src/App.test.tsx:188` |
| In-app Help and product docs describe shipped behavior | T1-07: `frontend/src/helpTopics.ts`, `frontend/src/helpTopics.test.ts`, `README.md`, `PRODUCT.md` | `frontend/src/helpTopics.test.ts:37` |

No commits were made. The lead can stage and commit each ID after review.

## 3. Design and data flow

- `TerminalTab` | modified `frontend/src/App.tsx:56` | holds handle, xterm controls, size, buffered startup output, and status per tab | reuses the existing terminal and engine APIs. Confidence HIGH: two-session browser test passed.
- Tab bar | modified `frontend/src/App.tsx:400` and `frontend/src/app.css:323` | selects and closes tabs with scroll overflow and 44px controls | no new component needed. Confidence HIGH: browser test checked phone target height and keyboard switching.
- Host-key return | modified `frontend/src/components/HostKeyPrompt.tsx:164` | returns to a live sibling while the pending host key remains unanswered | reuses the existing prompt. Confidence HIGH: focused App test passed.
- Keepalive | modified `engine/sshclient/client.go:159` | sends `keepalive@openssh.com` as a global request, accepts a failure reply as proof of life, closes after missed replies | reuses `ssh.Conn.SendRequest`. Confidence HIGH: local module source and [official x/crypto v0.58.0 API](https://pkg.go.dev/golang.org/x/crypto@v0.58.0/ssh), accessed 2026-11-01, match the call; Go tests passed.
- Docs | modified `frontend/src/helpTopics.ts`, `README.md`, `PRODUCT.md` | explain tabs, shortcuts, host-key return, relay limits, and keepalive recovery | existing offline Help topics retained. Confidence HIGH: Help test passed.
- Connect form to session: submitted values -> existing `connectSession` -> one `SshHandle` and one tab, then one mounted `Terminal`.
- Server output: the tab's `onData` -> that tab's xterm controls; output arriving before mount waits in that tab only.
- Input and resize: selected xterm, key bar, clipboard, or gesture -> selected handle; each tab stores its own fitted size.
- Close and loss: tab close or page cleanup -> only owned handle or all handles, respectively; keepalive failure -> connection close -> existing connection-lost callback.

Out of scope: split panes, workspace restore, broadcast input, cross-device recovery, app-owned tab cap, and changes to relay or vault formats.

## 4. Self-review

- R-01 | MED | `frontend/src/components/HostKeyPrompt.tsx:164` | modal host-key check initially covered sibling tabs | added Return to open terminal and a regression test; pending check resumes from its tab.
- R-02 | MED | `frontend/src/App.tsx:252` | closing an in-flight tab could leave a late handle alive | success now checks tab membership and closes a late handle; `frontend/src/App.test.tsx:288` covers the race.
- R-03 | LOW | `frontend/src/App.tsx:482` | lost-tab error initially nested an alert inside a paragraph | removed the wrapper; App tests pass without DOM nesting warnings.
- R-04 | MED | `frontend/src/App.tsx:122` | React unmount alone did not explicitly close handles on browser navigation | added `pagehide` cleanup and `frontend/src/App.test.tsx:313`.
- Final review: no HIGH or MED findings remain. No debug output, dead code, new dependency, data-format change, or unrelated edit found.

## 5. Verification evidence

Commands used Node 26 via `source ~/.nvm/nvm.sh && nvm use 26` before npm. `npm ci` passed in frontend and relay. These are verbatim summary lines from the final runs:

```text
Go test: 84 passed in 4 packages
built dist/engine.wasm, dist/wasm_exec.js, dist/testsshd
Test Files  4 passed (4)
Tests  47 passed (47)
Test Files  29 passed (29)
Tests  306 passed (306)
All matched files use the correct format.
Finished in 9ms on 84 files using 24 threads.
✓ built in 153ms
21 passed (6.9s)
```

The real entry point ran in Playwright with the relay, WASM engine, and test SSH server. Its output included:

```text
✓  17 e2e/connect-flow.spec.ts:75:1 › keeps two live terminal sessions and closes only the selected one (1.1s)
21 passed (6.9s)
```

The new App tests exercised a failed second connection, a dropped sibling, a pending host-key check, and page cleanup. The Go tests exercised unanswered requests and failure replies. `GOOS=js GOARCH=wasm go vet ./...`, frontend and relay lint, frontend `npx tsc -b`, relay build, and `git diff --check` exited 0 with no diagnostics. Relay format check output: `All matched files use the correct format.` Engine build output is shown above. No test failed in the final runs.

## 6. Out of scope, adjacent problems, and limits

- Adjacent existing build warning: Vite's JavaScript chunk exceeds 500 kB. No chunking change was made.
- Browser WebSocket failures cannot identify whether a pre-upgrade 503 came from `MAX_SESSIONS`. The current error lists the limit and the operator's relay log as a possible cause. The actual 503 path was not verified end to end.
- Physical iOS and Android keyboard, safe-area, horizontal tab overflow, and screen-reader traversal were not checked. Chromium emulation checked 390px targets and the browser suite checked desktop switching.
- A real silent Wi-Fi loss was not reproduced. Go tests proved the request and close behavior; the existing browser connection-lost path was exercised separately.
- Docker images were not built because the sandbox may make buildx state read-only; no Docker build was attempted.
