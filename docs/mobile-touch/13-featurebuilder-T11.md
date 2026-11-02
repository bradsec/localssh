# T11 feature builder report

Building: `KEEPALIVE_MAX_SECONDS` configures the relay's v2 resume cap for operators. Done means each relay entry point applies the same validated cap, capabilities reports it, and the Chromium connect flow passes.

Assumption: an empty value counts as unset. The wildcard exception checks raw `ALLOWED_ORIGINS`, before the all-in-one script supplies its own default. This follows plan A-01. No unresolved ambiguity.

## Built

- `relay/src/keepalive-config.ts`: shared parser; unset defaults to 3600 seconds, except raw wildcard defaults to 0; accepts `unlimited` and integer seconds from 0 through 2147483.
- `relay/scripts/run-relay.ts`, `relay/scripts/run-all-in-one.ts`, `relay/scripts/run-local-relay.ts`: pass the parsed value to `startLocalRelay`. The all-in-one capability handler uses that same value. Invalid values exit 1 and log `invalid KEEPALIVE_MAX_SECONDS`.
- `compose.yaml`, `.env.example`: pass and describe the operator setting. Empty Compose value uses the parser default.
- `frontend/e2e/connect-flow.spec.ts`: both v2 relay spawns set `KEEPALIVE_MAX_SECONDS=3600` instead of passing `--resumable`.

## Design

- Parser | new `relay/src/keepalive-config.ts` | validates one env value | shared by all three scripts. Confidence HIGH: parser table and script tests.
- Relay scripts | modified three scripts | pass cap to existing `maxGraceMs` option | reuses relay policy and capability endpoint. Confidence HIGH: tests and Chromium E2E.
- Compose and example | modified two files | expose the setting | matches existing env wiring. Confidence HIGH: direct review.
- Data flow: environment value -> shared parser -> `maxGraceMs` -> relay grant and capability response.
- Out of scope: T19a operator documentation, frontend Settings and capability gating, and changes to relay protocol.

## Tests and checks

Requirement | Commit | Test
--- | --- | ---
Parser defaults, wildcard rule, values, bounds | none, per task instruction | `keepalive-config.test.ts` parser table
All three scripts apply policy and reject bad values | none, per task instruction | local capability smoke; three startup error cases
Compose and example env wiring | none, per task instruction | source review; Compose runtime unverified
Existing browser SSH flow | none, per task instruction | Chromium connect-flow, 19 passed

- Added `relay/src/keepalive-config.test.ts`: 11 parser cases, two local script capability cases, three invalid-script exit cases. Red smoke assertion: configured `600` returned `{ "maxGraceMs": 0, "resume": false }` before wiring. Green after wiring.
- `rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm test -- src/keepalive-config.test.ts`: `Test Files  1 passed (1)`; `Tests  16 passed (16)`.
- `rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm test` in `relay/`: `Test Files  7 passed (7)`; `Tests  184 passed (184)`.
- `rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm run build` in `relay/`: exit 0, `tsc -p tsconfig.build.json`.
- `rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm run lint` in `relay/`: exit 0, `oxlint src scripts test`.
- `rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm run format:check` in `relay/`: `All matched files use the correct format.`
- `rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm run test:e2e -- e2e/connect-flow.spec.ts --browser=chromium --reporter=line` in `frontend/`: `19 passed (52.2s)`. Initial run had `18 passed` and one `v2 relay exited: 1`; the second spawn still passed the removed flag. Fixed and reran.
- Frontend targeted format check: `All matched files use the correct format.`
- `rtk git diff --check`: exit 0.

## Self-review

- No change needed | HIGH confidence: all T11 parser cases, three script error paths, and local capability output have tests.
- No change needed | MED confidence: the all-in-one script passes one parsed value to both its capability handler and relay.
- No debug output, extra abstraction, or unrelated edits introduced.

## Unverified

- Live all-in-one and production `run-relay` capability responses were not exercised through their server ports. The local entry point was exercised through HTTP; the shared parser and all three invalid startup paths were tested.
- Docker Compose expansion was not run. The new environment entry was reviewed in `compose.yaml`.

## Notes for the lead

- Write set also changed the existing E2E call sites because removal of `--resumable` would break them. No fixtures, mocks, or type-only call sites changed.
- No commit or branch was created, per the task instruction. Accepted uncommitted work was preserved.
- T19a must add the full operator guidance to README, relay README, and Help. This task only adds the `.env.example` setting.
