# Mobile touch review recheck

## Change and scope

Base: `HEAD`. Head: uncommitted working tree. The recheck covered the F1–F8 fix paths and tests in `frontend/src/App.tsx`, `frontend/src/components/{Terminal,SettingsDialog,FilePanel}.tsx`, `relay/src/local-relay.ts`, `engine/sshclient/client.go`, and `engine/vaultjs.go`. The corresponding tests, callers, and sibling controls were checked. These files sit inside a larger change of more than 800 lines; unrelated feature code, CSS, and generated output were skimmed only.

Change (inferred from `15-changereviewer.md` and `16-featurebuilder-review-fixes.md`): fix eight mobile recovery defects so reconnect, resume, gestures, and settings remain safe and usable.

## Verdict

**CHANGES REQUIRED**, decided by N1 and N2. Confidence **HIGH** for the verdict: N1 has a direct traced input path; N2 has a reachable overlapping-save path. Route both to the **change author**.

## F1–F8 status

- **F1 fixed** | `frontend/src/App.tsx:642-665` matches saved host, port, and username before vault reconnect; `frontend/src/App.test.tsx:329-350` covers each edited field. Confidence HIGH.
- **F2 fixed** | `relay/src/local-relay.ts:596-600,635-654,743` caps and releases pending first-frame slots; `relay/src/local-relay.test.ts:813-840` proves a second idle socket gets HTTP 503. Confidence HIGH.
- **F3 fixed** | `engine/sshclient/client.go:326-329` closes the transport before the SSH channel; `engine/sshclient/client_test.go:34-54` proves the modeled blocked channel close completes. A real full detached WebSocket buffer remains unverified. Confidence MED.
- **F4 fixed for its stated rotation trigger** | `frontend/src/components/Terminal.tsx:275,302-314` reads current width during a gesture; `frontend/e2e/key-bar.spec.ts:315-361` exercises landscape-to-portrait rotation. N1 covers a separate phone landscape state. Confidence HIGH.
- **F5 fixed for overlapping appearance selectors** | `frontend/src/components/SettingsDialog.tsx:277-329` disables selectors during a host save; `frontend/src/components/SettingsDialog.test.tsx:172-213` checks a later line-height save. N2 covers a competing control left active. Confidence HIGH.
- **F6 fixed** | `frontend/src/components/FilePanel.tsx:341-389,551,600-604` refreshes stored records after completion or dismissal; `frontend/src/components/FilePanel.test.tsx:1210-1247` reveals the older record in both cases. Confidence HIGH.
- **F7 fixed for simultaneous resume attempts** | `frontend/src/components/FilePanel.tsx:637-657` locks Resume, Retry, and Dismiss through the transfer; `frontend/src/components/FilePanel.test.tsx:980-1010` proves only one of two simulated panels writes. Separate browser tabs remain unverified. Confidence MED.
- **F8 fixed** | `engine/vaultjs.go:169-180` rejects unknown nested fields and trailing JSON; `engine/vaultjs_test.go:11-23` tests `themeNmae` in the WASM target. Confidence HIGH.

## New findings

N1 | HIGH | `frontend/src/components/Terminal.tsx:275` | `isPhoneScreen` checks only width, while the app treats short touch landscape as phone mode (`frontend/src/App.tsx:179-181`); both swipe paths can still call `onInput` (`Terminal.tsx:302-314,460-462`) | On a touch phone at 844 × 390, `isShortLandscape` is true (`frontend/src/shortLandscape.ts:3-4`) but the width query is false; a 70 px horizontal swipe sends Tab or Escape (`frontend/src/terminalGestures.ts:75-77,93-101`) | Use the same live phone-mode condition for gesture suppression and test a swipe at 844 × 390 before rotation | HIGH

N2 | MEDIUM | `frontend/src/components/SettingsDialog.tsx:340-349` | The reset button remains enabled during an appearance save and starts another `onSaveHost`; `frontend/src/vault/useVault.ts:64-67` rejects that second action | With a saved host override, change font size and immediately select “Use all-hosts settings for this host” before the first vault write finishes; reset reports failure and the override persists | Disable scope-changing and reset controls during host saves, and test the pending-save reset path | HIGH

## Callers and sibling paths checked

Traced reconnect through `attemptConnect`, `connectSession`, vault password resolution, and saved-entry edits. Traced close through `sessionBridge.finishClose`, `Session.Close`, and resumable `Conn.Close`. Checked v1 and v2 admission, idle handshakes, and detached-session eviction. Checked pointer move and pointer end gestures in portrait and short landscape. Checked host appearance selectors, scope and reset controls, vault serialization, download record refresh, and Resume, Retry, Dismiss lock coverage.

## Check results

Commands ran from `engine`, `frontend`, or `relay` as appropriate. Node 26.13.0 was selected for Node checks. Verbatim result lines:

```text
rtk go test ./...
Go test: 126 passed in 5 packages

rtk env GOOS=js GOARCH=wasm PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH go test -exec ~/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.27.3.linux-amd64/lib/wasm/go_js_wasm_exec .
ok  	engine	0.267s

relay: rtk npm test
 Test Files  7 passed (7)
      Tests  185 passed (185)
relay: rtk npm run build
> tsc -p tsconfig.build.json
relay: rtk npm run lint
> oxlint src scripts test
relay: rtk npm run format:check
All matched files use the correct format.

frontend: rtk npm test
 Test Files  39 passed (39)
      Tests  530 passed (530)
frontend: rtk npm run build
✓ built in 184ms
frontend: rtk npm run lint
> oxlint
frontend: rtk npm run format:check
All matched files use the correct format.
frontend: rtk npm run test:e2e -- --grep 'swipes stay silent after a live terminal rotates'
  1 passed (5.7s)

rtk git diff --check HEAD
exit 0, no output
```

An initial WASM test invocation without `-exec` could not execute the binary: `fork/exec /tmp/go-build3242088917/b001/engine.test: exec format error`. The executor run above passed.

## Not reviewed or verified

The full end-to-end suite, physical iOS/Android behavior, a real full-buffer disconnect, and two independent browser tabs using OPFS were not run. No changing external API or advisory claim drives this verdict. No source code was edited in this review.
