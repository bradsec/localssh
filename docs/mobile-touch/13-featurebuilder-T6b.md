# T6b feature builder report

Building: relay capability discovery for browser SSH users; done means standalone and all-in-one relays answer `GET .../capabilities` with the active policy.

Assumption: the all-in-one relay reports `maxGraceMs: 0` until T11 wires `KEEPALIVE_MAX_SECONDS`. Its WebSocket relay uses the same value, so discovery stays truthful. No unresolved spec ambiguity.

## Built

Requirement | Implementation | Test | Commit
--- | --- | --- | ---
JSON shape, `no-store`, GET only, prefixed path | `relay/src/capabilities.ts:19` | `relay/src/capabilities.test.ts:33`, `:46`, `:94` | None, per task instruction
Allowlist, wildcard, same-origin and loopback CORS | `relay/src/capabilities.ts:35` | `relay/src/capabilities.test.ts:54`, `:70`, `:84` | None
Standalone HTTP handler, WebSocket upgrade, port cleanup | `relay/src/local-relay.ts:577`, `:629`, `:748` | `relay/src/capabilities.test.ts:101`, `:140`, `:158` | None
All-in-one routing before static files and `/relay` 404 | `relay/src/web-server.ts:21`, `:32`; `relay/scripts/run-all-in-one.ts:24` | `relay/src/web-server.test.ts:66`, `:95` | None

Existing partial T6b edits in the accepted worktree already covered the feature. This step formatted `relay/src/capabilities.test.ts` and verified the full task. No unrelated changes were reverted or committed.

## Design decisions

- `handleCapabilities` | new `relay/src/capabilities.ts` | One HTTP policy handler | Reuses `assertOriginAllowed` from `relay/src/access.ts:49`. Confidence HIGH, code and tests.
- Standalone server | modified `relay/src/local-relay.ts` | Shares one HTTP server with `ws`; closes owned server on shutdown | Reuses Node HTTP and existing `ws`. Confidence HIGH, port reuse tests.
- All-in-one routing | modified `relay/src/web-server.ts`, `relay/scripts/run-all-in-one.ts` | Routes discovery before static fallback; shares the relay cap | Confidence HIGH, code and handler test.
- Data flow: HTTP GET path and Origin -> capability handler and origin policy -> JSON response with optional CORS header.
- Out of scope: T11 environment parser and default cap; frontend capability fetch and v2 gating in T12b and T10.

## Checks

From `relay/`, targeted command `rtk npm test -- src/capabilities.test.ts src/web-server.test.ts src/local-relay.test.ts`:

```text
Test Files  3 passed (3)
     Tests  82 passed (82)
```

V-RELAY:

- `rtk npm test`: `Test Files  6 passed (6)`; `Tests  168 passed (168)`.
- `rtk npm run build`: `> tsc -p tsconfig.build.json`, exit 0.
- `rtk npm run lint`: `> oxlint src scripts test`, exit 0.
- `rtk npm run format:check`: `All matched files use the correct format.`, exit 0.
- `rtk git diff --check`: exit 0, no output.

The standalone integration test exercised real HTTP GETs on both paths and a real WebSocket upgrade. It closed the relay and bound a new server to the same port. Error cases exercised POST/HEAD 405, unknown-origin CORS omission, and a listen failure.

## Self-review

- No change needed. The diff follows the T6b write set and adds no dependency.
- The branch remains uncommitted, as directed. Other accepted worktree edits remain present.

## Unverified

- A launched all-in-one process was not exercised. Its handler was tested through `createWebHandler`; its script compiled and passed lint.
- Browser CORS enforcement was not exercised in a browser. Response headers and policy decisions were tested over HTTP.

## Notes for the lead

- T11 must replace the temporary `maxGraceMs = 0` in `relay/scripts/run-all-in-one.ts:24` with the validated environment policy. Keep one value for discovery and `startLocalRelay`.
- No type-only call sites, fixtures, or mocks needed changes in this step.
