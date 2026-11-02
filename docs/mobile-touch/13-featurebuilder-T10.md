# T10 featurebuilder report

Building: page lifecycle and v2 connection selection for browser SSH users, done means a backgrounded tab resumes the same SSH session when the relay still holds it.

Assumptions: The five v2 terminal errors use `Session expired.` and the UI revision's network cause line; T18a will choose the background cause from `lostWhileHidden`.

## Built

- `frontend/src/App.tsx:105`: added per-tab transport, granted grace, and background-loss state.
- `frontend/src/App.tsx:204`: fetches relay capabilities per page load and retries an unknown result when connecting.
- `frontend/src/App.tsx:213`: detaches v2 tabs on `pagehide`, closes v1 tabs, resumes v2 tabs on return events, and closes all handles on unmount.
- `frontend/src/App.tsx:342`: sends `keepAliveMs` only for a non-Off choice and `resume: true`; suppresses input while resuming.
- `frontend/src/connectionErrors.ts:122`: maps `expired`, `superseded`, `resume_disabled`, `offset_mismatch`, and `retention_exceeded` to the session-expired copy and recovery cause.
- `README.md:476`: documents detach, return, and reload behavior.

## Files changed

Product: `frontend/src/App.tsx`, `frontend/src/connectionErrors.ts`, `README.md`.

Tests and fixtures: `frontend/src/App.test.tsx`, `frontend/src/connectionErrors.test.ts`, `frontend/e2e/connect-flow.spec.ts`. The E2E fixture now excludes the App's v2 connect frames from its low-level WASM assertion and selects Off for its v1 assertion.

No type-only call sites changed. No branch or commit created, as instructed. All pre-existing uncommitted work remains in place.

## Spec coverage

| Requirement | Commit | Test |
| --- | --- | --- |
| Off, disabled, and unknown capabilities use v1; enabled uses v2 | None, per task instruction | `App.test.tsx` Off, disabled, unknown, and v2 cases; WebKit v1 frame E2E |
| `pagehide` detaches v2 and closes v1 | None | `App.test.tsx` lifecycle cases; `connect-flow.spec.ts` pagehide E2E |
| `pageshow`, visible, and `online` resume v2; hidden alone does nothing | None | `App.test.tsx` return event case; pagehide E2E |
| Explicit Disconnect and unmount close; tabs stay isolated | None | `App.test.tsx` two-tab Disconnect case and existing unmount cases |
| Reload starts fresh | None | `connect-flow.spec.ts` pagehide and reload E2E |
| v2 errors use recovery copy | None | `connectionErrors.test.ts` code and engine-string cases |

## Design decisions and review

- HIGH | `App.tsx:342` | Reused `requestedGraceMs`, `fetchRelayCapabilities`, and `connectSession` hooks; local source and passing tests support the integration.
- HIGH | `App.tsx:213` | Kept transport state on each tab, so a closed tab cannot trigger another tab's resume; two-tab test supports isolation.
- MED | `connectionErrors.ts:122` | Used one session-expired variant and the revision's network cause line for all five codes; no code-specific copy is specified.
- Review | No change needed | Diff check, scoped tests, full frontend gates, and browser lifecycle checks found no T10 defect.

## Checks and results

Node 26.13.0 used for every frontend command. Commands ran in `frontend/`.

```text
rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm test
 Test Files  35 passed (35)
      Tests  421 passed (421)
```

```text
rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm run build
> tsc -b && vite build
✓ built in 185ms
```

```text
rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm run lint
> oxlint
```

```text
rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm run format:check
All matched files use the correct format.
Finished in 10ms on 99 files using 24 threads.
```

```text
rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm run test:e2e -- e2e/connect-flow.spec.ts --browser=webkit --reporter=line
  1 skipped
  19 passed (59.2s)
```

```text
rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm run test:e2e -- e2e/connect-flow.spec.ts --browser=chromium --grep 'pagehide resumes' --reporter=line
  1 passed (6.0s)
rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm run test:e2e -- e2e/connect-flow.spec.ts --browser=webkit --grep 'pagehide resumes' --reporter=line
  1 passed (6.6s)
```

The WebKit E2E test dispatches `pagehide`, closes the socket, dispatches `pageshow`, observes a `resumed` frame, echoes input, and confirms reload shows the connect form. The full WebKit run skips the existing Chromium-only CDP case.

## Unverified items

- Physical iPhone Safari background suspension and page eviction remain unverified; Playwright WebKit does not reproduce those OS events.
- The full WebKit connect-flow run preceded the final one-line background-state guard and two error-copy tests. The final browser lifecycle test and full frontend gates ran after them.

## Notes for the lead

- T18a owns visible Resuming status, recovery row, and cause selection from `lostWhileHidden`.
- T18b owns one-tap Reconnect after expiry.
- Adjacent observed issue: `README.md:460` still names the removed Appearance menu. This came from accepted earlier work; T10 did not change it.
