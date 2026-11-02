# T19a featurebuilder report

## Spec read and assumptions

Building: operator keep-alive guidance for deployers and Help readers, done means the cap, limits, endpoint, and risks are documented and the Help assertion passes.

- A-01: An unset `ALLOWED_ORIGINS` in the combined image uses same-origin mode and the 3600-second cap. Literal `*` disables resume unless the cap is explicit. Confidence HIGH: `relay/scripts/run-all-in-one.ts:20-23` and `relay/src/keepalive-config.ts:1-8`.
- No other T19a ambiguity required a decision.
- Existing dirty work was accepted by the lead. No branch or commit was made, as explicitly required for this task.

## Built

| Requirement | Files | Commit | Test or review |
| --- | --- | --- | --- |
| Cap default, `0`, `unlimited`, wildcard rule | `README.md:268`, `relay/README.md:36`, `frontend/src/helpTopics.ts:126` | None, instructed | `frontend/src/helpTopics.test.ts:47-50`; parser and scripts reviewed |
| Active plus detached capacity and RAM sizing | `README.md:267,306-309`, `relay/README.md:48-51` | None, instructed | Manual comparison with `relay/src/local-relay.ts:271-281` and `docs/mobile-touch/11-solutionarchitect-amendment.md:59-65` |
| 90-second lag, stalled output, SSH server expiry, relay lifetime, `tmux` | `README.md:300-306`, `relay/README.md:51-55` | None, instructed | Manual review against `relay/src/local-relay.ts:45` and the approved amendment |
| Capability path, CORS, page CSP | `README.md:292-298`, `relay/README.md:57-62` | None, instructed | Manual review against `relay/src/capabilities.ts:23-58` and `deploy/nginx.conf:8,16-23` |
| Preserve page-close text for v1/Off | `README.md:469-473` | None, instructed | Manual review against `frontend/src/App.tsx:194` |

Design: reuse existing README configuration table and hosting Help topic; add no new runtime path or dependency. Input `KEEPALIVE_MAX_SECONDS` becomes a relay cap, then `/capabilities` exposes it to a same-origin page. Confidence HIGH from the local parser and handler. RAM estimate confidence MED because it is derived from buffer limits, not measured.

Out of scope: T10 browser resume UI, T19b user guide and Help updates, direct native selection handles, and unrelated dirty work.

## Checks

Test first: `rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm test -- src/helpTopics.test.ts` failed before the Help edit with:

```text
Test Files  1 failed (1)
     Tests  1 failed | 7 passed (8)
AssertionError: expected 'Docker Compose serves the app and rel…' to contain 'KEEPALIVE_MAX_SECONDS'
```

Focused test after edit:

```text
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

V-FE, from `frontend/`, using Node 26: `rtk npm test && rtk npm run build && rtk npm run lint && rtk npm run format:check`. Each command used `rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH` to select Node 26.

```text
 Test Files  32 passed (32)
      Tests  373 passed (373)
✓ built in 218ms
> oxlint
All matched files use the correct format.
Finished in 7ms on 94 files using 24 threads.
exit 0
```

`rtk git diff --check`: exit 0, no output.

Browser Help entry point: `rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm run test:e2e -- e2e/help.spec.ts --browser=chromium --reporter=line`.

```text
Running 5 tests using 1 worker
  5 passed (7.2s)
exit 0
```

Manual env audit: `compose.yaml` uses `LOCALSSH_VERSION`, `BIND_ADDRESS`, `FRONTEND_PORT`, `ALLOWED_HOSTS`, `ALLOWED_ORIGINS`, `ALLOWED_PORTS`, `MAX_SESSIONS`, `KEEPALIVE_MAX_SECONDS`, and `TARGET_CONNECT_TIMEOUT_MS`. The scripts additionally use `PUBLIC_HOSTS`, `PORT`, `HOST`, `TLS_CERT_FILE`, `TLS_KEY_FILE`, and `STATIC_ROOT`. The README table names each variable.

## Self-review

- No change needed | HIGH | `README.md:259-273` | Operator variables are covered by the table.
- No change needed | HIGH | `README.md:469-473` | Page-close wording remains true for the existing v1 path.
- No change needed | MED | Four T19a files | No unrelated API, data format, or runtime change.

## Unverified items and notes for the lead

- The browser Help flow passed, but the E2E suite does not assert the new paragraph's exact text. The focused unit test does. No live relay deployment or capability request was run; endpoint behavior belongs to T6b/T11.
- No fixtures, mocks, or type-only call sites needed updates.
- No adjacent defect was confirmed in this write set.
- Build emitted Vite's existing warning that a minified chunk exceeds 500 kB. This task did not change bundle structure.
