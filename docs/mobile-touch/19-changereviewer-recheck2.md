# Mobile touch review recheck 2

## Change and scope

Base: `HEAD`. Head: uncommitted working tree. Inspected the `HEAD` diff only for `frontend/src/App.tsx`, `frontend/src/components/Terminal.tsx`, and `frontend/e2e/key-bar.spec.ts` (1,128 added, 121 removed), plus untracked `frontend/src/components/SettingsDialog.tsx` and its test. The wider working tree exceeds 800 changed lines; other feature paths were not reviewed.

Change (inferred from the N1/N2 reports): use current phone mode for terminal gestures and block competing host setting saves so phone swipes send no shell keys and a pending appearance save completes before scope or reset changes.

## Verdict

**APPROVE**, confidence **HIGH** for N1 and N2. Both reported triggers are guarded and exercised by regression tests. No new defect was confirmed in these fix paths. Route any later fix to the change author.

## Per-finding status

- **N1 fixed**, confidence **HIGH**. `App.tsx:179-181,1131,1176` passes phone mode, including short touch landscape, to both terminal instances. `Terminal.tsx:73-74,164,309,466` reads its current value on pointer move and release. At 844 × 390, the 70 px swipe sends no WebSocket frame; the same test checks portrait after rotation (`frontend/e2e/key-bar.spec.ts:315-393`). The test passed in the full E2E run.
- **N2 fixed**, confidence **HIGH**. `SettingsDialog.tsx:224,341` disables scope and reset during an appearance save. `SettingsDialog.test.tsx:217-256` holds that save pending, checks both controls are disabled and reset starts no second save, then completes the save and resets. The unit suite passed.

## New findings

None confirmed in the N1/N2 fix paths.

## Callers and sibling paths checked

Traced `App` phone mode through viewport updates (`App.tsx:434`) and both `Terminal` mounts. Checked both gesture emission paths, in-flight move and pointer release, and the neighboring one-finger scroll condition (`Terminal.tsx:309,381,466`). Traced `SettingsDialog.onSaveHost` through `App.tsx:928-932` to the vault save. Checked the four appearance selectors, scope selector, reset button, and their pending-save test. No public API, config, or data-format change was found in these fixes.

## Check results

Node 26.13.0 was selected for frontend commands. Verbatim result summaries:

```text
rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm test
 Test Files  39 passed (39)
      Tests  531 passed (531)

rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm run lint
> oxlint

rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm run format:check
All matched files use the correct format.

rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH E2E_RELAY_PORT=18788 npm run test:e2e
  48 passed (1.5m)

rtk git diff --check HEAD -- frontend/src/App.tsx frontend/src/components/Terminal.tsx frontend/e2e/key-bar.spec.ts
exit 0, no output
```

The E2E command ran the configured frontend build and started its preview server. After exit, `ps -eo pid,comm` showed no relay or testsshd process in this session; port 18788 was no longer listening. An unrelated listener on port 8787 predates this run and was left untouched.

## Not reviewed or verified

The larger mobile-touch change, physical iOS/Android touch behavior, and ownership of the pre-existing port 8787 listener were outside this recheck. No source code was edited. No version-sensitive external claim is needed for this verdict.
