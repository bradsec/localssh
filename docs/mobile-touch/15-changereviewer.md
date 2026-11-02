# Phase 2 mobile touch change review

## Change and scope

Base: `HEAD`. Head: full uncommitted working tree, including untracked files. `git diff --numstat HEAD` covers 61 tracked files, with 9,005 added and 668 removed lines. Untracked work adds 48 `docs/mobile-touch` files (4,342 lines), 17 frontend files (2,120 lines), and four relay files (317 lines). Total change before this report: 15,784 added and 668 removed lines. The hand-written relay, engine, frontend, and user-facing documentation were reviewed first; build reports, large test additions, and CSS were skimmed for coverage and contract changes.

Change (inferred from specs `02`, `03`, `05`, `08`, `10`, `11`, and `12`): add phone terminal controls, session recovery, keep-alive, and resumable downloads so mobile users can continue work after background loss.

Project gates: `engine/go.mod` uses `go test ./...`; `frontend/package.json` defines test, e2e, lint, format check, and build; `relay/package.json` defines test, lint, format check, and build.

## Verdict

**CHANGES REQUIRED**, decided by F1, F2, F3, and F4. Confidence **HIGH**: each has a concrete trigger and a traced path; F2 also has a direct control run. Route all findings below to the **change author**.

## Findings

F1 | CRITICAL | `frontend/src/App.tsx:645` | One-tap reconnect can disclose an edited vault password to the old tab's SSH host: `reconnectTab` matches only `entryId` and `hasPassword`; `attemptConnect` uses the tab's old host/user at `App.tsx:651-660`, while `engine/main.go:80` resolves the entry's current password | Connect a tab from saved host A, edit the same entry ID to host B with B's password (`frontend/src/components/SavedHostEditor.tsx:56-76`), then reconnect the dropped A tab; B's password is sent to A after A's existing host-key check | Change author: require saved entry host, port, and username to match the tab before vault reconnect; otherwise open the prefilled credential form and add an edited-entry regression test | HIGH

F2 | HIGH | `relay/src/local-relay.ts:595` | Resume mode removes the handshake cap, so idle WebSockets bypass `MAX_SESSIONS`; `admitConnect` then counts them at `local-relay.ts:276-281` | With `maxSessions:1` and resume enabled, two idle sockets both open and the valid connect is refused; direct proof: `idle first=open second=open tracked=2`. With resume disabled, control output is `idle first=open second=HTTP 503 tracked=1`. Each idle connection lasts until the 10-second first-frame timer at `local-relay.ts:646-648` | Change author: enforce a bounded handshake count before upgrade while preserving detached-session eviction at connect; test idle-socket pressure | HIGH

F3 | HIGH | `engine/main.go:381` | Explicit disconnect can block before `[2,"close"]` is sent: `Session.Close` closes the SSH channel first (`engine/sshclient/client.go:326-328`), and that writes a packet through `Conn.Write` (`engine/wsconn/wsconn.go:1003-1021`) before transport close at `wsconn.go:1104-1141` | A detached upload fills the 256 KiB pending client buffer, then the user selects Disconnect; `Conn.Write` waits for resume or expiry, so an unlimited-grace relay can retain the session indefinitely | Change author: revoke/close the resumable transport before the blocking SSH channel shutdown, or bound that shutdown; test disconnect with a full detached buffer | HIGH

F4 | HIGH | `frontend/src/components/Terminal.tsx:158` | Phone gesture policy is frozen when the terminal mounts; `recogniseInFlight` still sends swipe keys while `targets.phoneScreen` is false (`Terminal.tsx:300-314`) | Rotate a live phone from landscape width above 719 px to portrait width below 720 px, then swipe horizontally; the tab stays mounted and sends Tab or Escape to SSH instead of suppressing shell input | Change author: read the current media-query result for each gesture or subscribe to its changes; add a width-transition test | HIGH

F5 | MEDIUM | `frontend/src/components/SettingsDialog.tsx:133` | Rapid per-host Settings changes can lose the second save: `saveAppearance` allows overlapping `onSaveHost` calls, but `frontend/src/vault/useVault.ts:64-67` returns false while the first action is pending | With an unlocked saved host, change font size then line height before the first vault write finishes; the second choice reports failure and does not persist | Change author: serialize per-host saves or disable dependent selectors during a save; test overlapping selections | HIGH

F6 | MEDIUM | `frontend/src/components/FilePanel.tsx:359` | Only the newest stopped download for a host/user is surfaced, and the lookup does not rerun when that record is resolved | Interrupt two downloads for the same host/user, then complete or discard the newest; the older partial has no Resume control until Files is closed and reopened | Change author: advance to the next stored record after resolving one, or show all stopped records; test two stored downloads | HIGH

F7 | MEDIUM | `frontend/src/components/FilePanel.tsx:595` | Stored downloads have no cross-page claim before resume; `frontend/src/downloadStore.ts:157-188` uses the same record and segment names for both writers | Open the same origin in two browser tabs, load one stopped record in both Files panels, then tap Resume in both; both can write its segments, and one failure can delete the other transfer's record (`FilePanel.tsx:549-553`) | Change author: claim the record across tabs before writing and release the claim when done; test two tabs resuming one record | MED

F8 | MEDIUM | `engine/vaultjs.go:171` | Nested terminal preferences silently accept unknown JSON fields, unlike the outer request and persisted document, which use strict decoders at `vaultjs.go:160-164` and `engine/vault/document.go:88-94` | Call `vaultUpsert` with valid terminal values plus `themeNmae`; it succeeds and stores the default theme instead of rejecting the misspelling | Change author: decode nested terminal preferences with `DisallowUnknownFields` and an EOF check; add a malformed-preferences test | HIGH

## Callers and sibling paths checked

Traced `reconnectTab` through `attemptConnect`, `connectSession`, WASM `sshConnect`, vault password resolution, and saved-entry editing. Traced explicit session close through the SSH channel and resumable `net.Conn`. Checked v1 versus v2 handshake admission, detached-session eviction, token rotation/takeover, capability CORS, wildcard-origin policy, heartbeat, and close frames. Checked phone gesture handlers across width changes; Settings through vault action serialization; download records through OPFS segments and Files recovery. The same-host reconnect and single-record download tests cover narrower states than F1, F6, and F7.

For F3, local `golang.org/x/crypto` **v0.58.0** source (`ssh/channel.go:629-635,233-252`, accessed **2026-11-02**) confirms channel close sends through `mux.conn.writePacket`. No current API or advisory claim from a secondary source drives a finding.

## Check results

Commands ran from the named project directory. Node 26 was selected for frontend tests and e2e because `frontend/package.json` requires `>=26 <27`. Exact output summaries:

```text
engine: rtk go test ./...
Go test: 125 passed in 5 packages

relay: rtk npm test
 Test Files  7 passed (7)
      Tests  184 passed (184)
relay: rtk npm run lint
> oxlint src scripts test
relay: rtk npm run build
> tsc -p tsconfig.build.json
relay: rtk npm run format:check
All matched files use the correct format.

frontend: rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm test
 Test Files  39 passed (39)
      Tests  523 passed (523)
frontend: rtk npm run lint
> oxlint
frontend: rtk npm run build
✓ built in 213ms
frontend: rtk npm run format:check
All matched files use the correct format.
frontend: rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH E2E_RELAY_PORT=18787 npm run test:e2e
  47 passed (1.5m)
```

The first frontend test invocation used Node 22 and failed before running tests: `~/.nvm/versions/node/v22.19.0/bin/node: bad option: --no-webstorage`. The Node 26 run above passed. `rtk git diff --check HEAD` exited 0 with no output.

## Not reviewed or not verified

No physical iOS/Android, VoiceOver, production relay load, or concurrent cross-tab OPFS run was available. F3 and F7 rest on traced paths rather than a browser reproduction. Generated WASM output and historical build reports were skimmed. Upload offset resume is deferred by `11` and `12`, so it was not treated as a missing feature. No code was changed in this review.
