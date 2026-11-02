# T19b featurebuilder report

Building: current user docs, in-app Help, and design rules for browser SSH users. Done means instructions match Settings, recovery, touch controls, and download resume.

Assumptions: T19b is documentation and Help copy only. Historical plans and reports retain their original wording. No branch or commit was made, per the task instruction. The accepted dirty worktree was preserved.

## Built and files changed

- `README.md:459`: Settings, line height, per-host scope, keep-alive risk, recovery, download resume, key bar, selection, and landscape guidance. The deployment cap section at `README.md:260` came from accepted earlier work.
- `docs/USER-GUIDE.md:32`: matching short user instructions and transfer loss warning.
- `frontend/src/helpTopics.ts:57`: updated Terminal, Background sessions, Files, Clipboard, and Connection problems topics. The Background topic and operator cap text existed in accepted earlier work.
- `frontend/src/helpTopics.test.ts:53`: new assertion for the guidance and absence of stale wording.
- `DESIGN.md:32`: Settings icon, recovery slot, short landscape exception, Settings and key editor, transfer states, and rules from M-01 to M-12. M-05 is marked LOW pending a physical device.

No test fixtures, mocks, or type-only callers changed.

## Spec coverage

Requirement | File | Test | Commit
--- | --- | --- | ---
Settings, line height, keep-alive options and risk | `README.md:459`, `docs/USER-GUIDE.md:40`, `frontend/src/helpTopics.ts:64` | `helpTopics.test.ts:53` | None, requested
Resuming, recovery, Reconnect, closed-tab Select text | `README.md:487`, `docs/USER-GUIDE.md:48`, `frontend/src/helpTopics.ts:72` | `helpTopics.test.ts:53` | None, requested
More keys, editor, Text keys, landscape, per-host scope | `README.md:543`, `docs/USER-GUIDE.md:98`, `frontend/src/helpTopics.ts:62` | `helpTopics.test.ts:53` | None, requested
Transfer pause, offset resume, iOS data loss | `README.md:518`, `docs/USER-GUIDE.md:87`, `frontend/src/helpTopics.ts:85` | `helpTopics.test.ts:53` | None, requested
DESIGN.md delta M-01 to M-12 | `DESIGN.md:5`, `DESIGN.md:32`, `DESIGN.md:42`, `DESIGN.md:62`, `DESIGN.md:75`, `DESIGN.md:87` | Manual spec review | None, requested
Remove stale claims in current guidance | `README.md:459`, `docs/USER-GUIDE.md:32`, `frontend/src/helpTopics.ts:57`, `DESIGN.md:32` | `helpTopics.test.ts:53`; manual sweep | None, requested

## Design decisions and self-review

- D-01 | HIGH | Reused existing Help topics and tests; no new runtime API or dependency. Evidence: `frontend/src/helpTopics.ts:57`, `frontend/src/helpTopics.test.ts:53`.
- D-02 | HIGH | Kept earlier deployment documentation and partial Help changes, then completed T19b around them. Evidence: initial `git diff` and final diff.
- D-03 | MED | Documented iOS partial-download loss as possible, matching `11` section 6. Physical storage eviction remains unverified.
- R-01 | LOW | `DESIGN.md:57` still listed an obsolete key order after the M-03 update. Fixed it to match K-02.
- R-02 | LOW | README implied a read-only view selection went through the Clipboard menu. Clarified live selection versus device Copy at `README.md:602`.
- No remaining review finding in this write set.

## Checks and results

- Test first: `rtk env PATH=~/.nvm/versions/node/v26.13.0/bin:$PATH npm test -- src/helpTopics.test.ts` failed as intended: `expected 'Select New terminal to connect to ano…' to contain 'More keys'`.
- Focused test after copy update: `Test Files  1 passed (1)`; `Tests  9 passed (9)`.
- V-FE test: `Test Files  39 passed (39)`; `Tests  523 passed (523)`.
- V-FE build: `✓ built in 200ms` (exit 0). Vite reported a chunk over 500 kB.
- V-FE lint: `> oxlint` (exit 0).
- V-FE format: first run found `src/helpTopics.test.ts`; formatted that file. Final output: `All matched files use the correct format.`
- Real Help entry point: Chromium `e2e/help.spec.ts` filtered to the connect-screen Help test: `1 passed (5.1s)`.
- Full existing Help E2E: `1 failed`; `4 passed (12.4s)`. Failure at `frontend/e2e/help.spec.ts:66`: expected `The server refused the connection.`; received `Could not reach the relay. Check the app address and relay logs, then try again.` This test's relay setup did not reach its intended target-refusal path. No T19b runtime file was changed.
- Manual `rtk grep -rn 'Appearance\|Swipe' README.md docs frontend/src`: hits remain in historical reports, plans, and the internal `saveAppearance` function name. No current README, USER-GUIDE, DESIGN, or Help copy hit. `rtk git diff --check` passed.

## Out of scope and unverified

- No runtime behavior, protocol, upload resume, or new options. T19b changes guidance only.
- Physical iOS background, eviction, native selection, VoiceOver, short landscape, and default key-order usability remain unverified. M-05 has LOW confidence pending device proof.
- SUSPECTED adjacent issue: `e2e/help.spec.ts:60` needs its target-refusal setup reviewed. The observed failure was a relay error, not a target refusal. Not changed in this task.

## Notes for the lead

- The requested V-FE commands pass after formatting. The broader Help E2E still has the unrelated failure above.
- No branch, commit, stash, checkout, or reset was used. Accepted uncommitted work remains in place.
