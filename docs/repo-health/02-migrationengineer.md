# Repository health: dependency migration

**Status: STOPPED at container and release verification, 2026-10-31.** All selected target versions are in the worktree. Local checks pass. Docker Buildx cannot write state, and no live GitHub workflow ran. The lead must verify both images and the release workflow before calling this complete.

Branch: `review/2026-10-31`. Rollback point: `231dae0` (HEAD). This prior report was the only pre-existing uncommitted file. No branch, commit, tag, push, or PR was made. Before commits, rollback means restoring the tracked migration files from HEAD and removing this report. After lead commits, revert those commits in reverse order. No persisted format changed.

All primary sources below were accessed **2026-10-31**. Before and after npm versions are lockfile versions, cross-checked with `npm outdated --json`. Docker tags were checked against official image listings, but image contents were not run.

## Version table

| Component | Before | After | Release notes and migration source |
| --- | --- | --- | --- |
| Go | 1.27.0 | 1.27.3, `engine/go.mod:3`, `Dockerfile:3` | [downloads](https://go.dev/dl/), [patch history](https://go.dev/doc/devel/release), [image](https://hub.docker.com/_/golang/tags?name=1.27.3-alpine) |
| Go modules | x/crypto 0.56.0, x/sys 0.47.0 | 0.58.0, 0.49.0, `engine/go.mod:5-7` | [crypto module](https://pkg.go.dev/golang.org/x/crypto@v0.58.0), [sys module](https://pkg.go.dev/golang.org/x/sys@v0.49.0); full upstream change history unverified |
| Node.js | CI and images major 24, local 24.16.0 | 26.13.0 LTS, `Dockerfile:11`, `relay/Dockerfile:3,12`, `.github/workflows/release.yml:79` | [26.0.0](https://nodejs.org/en/blog/release/v26.0.0/), [26.13.0](https://nodejs.org/en/blog/release/v26.13.0), [image](https://hub.docker.com/_/node/tags?name=26.13.0-alpine) |
| nginx | 1.29 Alpine | 1.30.6 Alpine, `Dockerfile:25` | [stable release](https://nginx.org/), [image tags](https://github.com/docker-library/official-images/blob/master/library/nginx) |
| Frontend runtime | React/DOM 19.2.8, idb 8.0.3, Source Code Pro 5.3.0 | 19.3.1, 8.0.4, 5.3.1, `frontend/package.json:23-29` | [React 19.3](https://react.dev/blog/2026/09/09/react-19-3), [npm registry](https://www.npmjs.com/) |
| Frontend runtime unchanged | xterm 6.0.0, fit 0.11.0, five fonts 5.3.0 | Same, current according to npm registry | [npm registry](https://www.npmjs.com/) |
| Frontend build | Vite 8.2.2, React plugin 6.1.1, TypeScript 7.0.2 | 8.3.5, 6.1.2, TypeScript unchanged, `frontend/package.json:39-46` | [Vite releases](https://github.com/vitejs/vite/releases), [npm registry](https://www.npmjs.com/) |
| Frontend test tools | Vitest 4.1.11, jsdom 29.1.1, Playwright 1.62.1 | 5.0.5, 30.1.3, 1.64.1, `frontend/package.json:31,41,46` | [Vitest migration](https://vitest.dev/guide/migration/), [Vitest releases](https://github.com/vitest-dev/vitest/releases), [jsdom releases](https://github.com/jsdom/jsdom/releases), [Playwright releases](https://github.com/microsoft/playwright/releases) |
| Frontend other dev tools | testing-library/dom 10.4.1, user-event 14.6.6, Node types 24.13.3, React types 19.2.x, fake-indexeddb 6.2.5, oxfmt 0.65.0, oxlint 1.80.0 | 10.4.2, 14.6.8, 26.6.6, React types 19.3.0, 6.2.7, 0.75.0, 1.90.0, `frontend/package.json:32-44` | [Oxc releases](https://github.com/oxc-project/oxc/releases), [npm registry](https://www.npmjs.com/) |
| Relay runtime | ws 8.21.3 | 8.22.1, `relay/package.json:15` | [ws releases](https://github.com/websockets/ws/releases), [npm registry](https://www.npmjs.com/) |
| Relay dev tools | Node types 24.13.3, ws types 8.18.1, oxfmt 0.65.0, oxlint 1.80.0, tsx 4.23.12, Vitest 4.1.11, TypeScript 7.0.2 | 26.6.6, 8.18.2, 0.75.0, 1.90.0, 4.23.15, 5.0.5, TypeScript unchanged, `relay/package.json:18-24` | [Vitest migration](https://vitest.dev/guide/migration/), [Oxc releases](https://github.com/oxc-project/oxc/releases), [npm registry](https://www.npmjs.com/) |
| GitHub Actions | checkout 6.1.0, setup-go 6.5.0, setup-node 6.5.0, attest v4, QEMU 3.7.0, Buildx 3.12.0, login 3.7.0, build-push 6.19.2 | 7.0.1, 7.0.0, 7.1.0, 4.2.2, 4.4.0, 4.4.1, 4.7.0, 7.4.0, `.github/workflows/release.yml:26-176` | [checkout](https://github.com/actions/checkout/releases), [setup-go](https://github.com/actions/setup-go/releases), [setup-node](https://github.com/actions/setup-node/releases), [attest](https://github.com/actions/attest/releases), [QEMU](https://github.com/docker/setup-qemu-action/releases), [Buildx](https://github.com/docker/setup-buildx-action/releases), [login](https://github.com/docker/login-action/releases), [build-push](https://github.com/docker/build-push-action/releases) |

[Go support policy](https://go.dev/doc/devel/release) supports Go 1.27 until two newer lines exist. [Node's schedule](https://github.com/nodejs/docker-node/blob/main/versions.json) ends Node 24 support on 2028-04-30 and Node 26 on 2029-04-30. Go 1.27.3 and nginx 1.30.6 include security fixes. Final `npm outdated --json` returned `{}` in both packages.

## Breaking changes and findings

Format: ID | IMPACT | change (source) | inspected usages | action; confidence. Impact and confidence are separate.

M-N1 | HIGH | Node 26 Web Storage global prevents Vitest's jsdom storage from replacing it ([Vitest issue](https://github.com/vitest-dev/vitest/issues/10867)) | `frontend/vitest.config.ts:4-8`, four test files using localStorage, `frontend/src/vault/vaultStore.test.ts:24` | Added `--no-webstorage` to Vitest workers at `frontend/vitest.config.ts:6`; 52 failures became 244 passing tests; confidence HIGH, reproduced.
M-V1 | MED | Vitest 5 clears mock call history by default and tightens some assertions ([migration guide](https://vitest.dev/guide/migration/), [5.0 notes](https://github.com/vitest-dev/vitest/releases/tag/v5.0.0)) | `frontend/src/App.test.tsx:107-108`, `frontend/src/vault/useVault.test.ts:41-50`, relay tests | No adaptation needed after full suites passed; confidence HIGH for release fact, MED for unexercised combinations.
M-J1 | MED | jsdom 30 raises Node minimum and changes CSS computed style ([30.0.0 notes](https://github.com/jsdom/jsdom/releases/tag/30.0.0)) | `frontend/vitest.config.ts:5`, `frontend/src/pageScrollLock.test.ts:4` | Moved Node first; frontend suite passed; confidence HIGH.
M-O1 | LOW | oxfmt 0.75 changes CSS font-list formatting ([Oxc releases](https://github.com/oxc-project/oxc/releases)) | `frontend/src/app.css:3-7` | Applied one formatting-only line; confidence HIGH, observed diff.
M-A1 | LOW | checkout 7 blocks unsafe fork checkout under pull_request_target and workflow_run ([7.0.0 notes](https://github.com/actions/checkout/releases/tag/v7.0.0)) | `.github/workflows/release.yml:3-8` uses only push and manual triggers | No behavior change; confidence HIGH.
M-A2 | MED | setup-buildx 4 removes deprecated inputs ([4.0.0 notes](https://github.com/docker/setup-buildx-action/releases/tag/v4.0.0)) | `.github/workflows/release.yml:134-135` supplies no inputs | No adaptation needed; confidence HIGH for static inspection, live run unverified.
M-G1 | LOW | nginx 1.30 defaults upstream proxy HTTP to 1.1 ([1.30 changes](https://nginx.org/en/CHANGES-1.30)) | `deploy/nginx.conf:12` already sets 1.1 | No config edit; confidence HIGH for static inspection, container unverified.
M-R3 | LOW | Development advisories in [prior review R3](01-codereviewengineer.md) | both npm lockfiles | Full audits went from frontend 7 and relay 6 findings to `found 0 vulnerabilities` each; confidence HIGH for audit counts, exploit reachability unproved.

No deprecated application API was found in inspected Node, Vitest, jsdom, nginx, or Action usages. No deprecation was silenced. No official codemod applied to these usages; Vitest provides the migration guide. Node runtime, Node types, relay engine range, CI, and images moved together. Vitest's Node and Vite peer floors are met. No persisted format, public API, or user-facing behavior was intentionally changed.

## Ordered steps and lead file groups

M1 | Go patch: `engine/go.mod`, `Dockerfile`, `README.md`; Go checks passed.
M2 | Go modules: `engine/go.mod`, `engine/go.sum`; Go checks passed. These overlap M1, so split hunks or combine M1 and M2.
M3 | Node 26 and M-N1: both Dockerfiles, CI, both manifests and lockfiles, `frontend/vitest.config.ts`, README; full local checks passed.
M4 | Independent npm updates: both manifests and lockfiles; full local checks passed.
M5 | jsdom 30: frontend manifest and lockfile; full frontend checks passed.
M6 | Vitest 5: both manifests and lockfiles; full checks passed.
M7 | oxfmt 0.75 and R3: both manifests and lockfiles, `frontend/src/app.css`; full checks passed after formatting.
M8 | nginx and Actions: `Dockerfile`, `.github/workflows/release.yml`; static checks passed. Container and live workflow verification remains open.

Package files and CI overlap across steps. Separate lead commits require hunk staging. No step rewrote browser vault, IndexedDB, relay protocol, or application configuration data.

## Verification evidence

These are verbatim command summary lines. Exit-0 checks without output are identified as such. Baseline used Node 24.16.0; final used Node 26.13.0. Final `go version`: `go version go1.27.3 linux/amd64`.

| Check | Baseline | Final |
| --- | --- | --- |
| Go tests | `Go test: 55 passed in 4 packages` | `Go test: 55 passed in 4 packages` |
| Go WASM vet | exit 0, no output | exit 0, no output |
| Go build | `built dist/engine.wasm, dist/wasm_exec.js, dist/testsshd` | `built dist/engine.wasm, dist/wasm_exec.js, dist/testsshd` |
| relay npm ci | `added 62 packages, and audited 63 packages in 1s`; `6 vulnerabilities (2 moderate, 2 high, 2 critical)` | `added 49 packages, and audited 50 packages in 644ms`; `found 0 vulnerabilities` |
| relay tests | `Test Files  4 passed (4)`; `Tests  38 passed (38)` | `Test Files  4 passed (4)`; `Tests  38 passed (38)` |
| relay lint, format, build | exit 0; `All matched files use the correct format.`; exit 0 | exit 0; `All matched files use the correct format.`; exit 0 |
| frontend npm ci | `added 139 packages, and audited 140 packages in 1s`; `7 vulnerabilities (2 moderate, 3 high, 2 critical)` | `added 124 packages, and audited 125 packages in 926ms`; `found 0 vulnerabilities` |
| frontend tests | `Test Files  26 passed (26)`; `Tests  244 passed (244)` | `Test Files  26 passed (26)`; `Tests  244 passed (244)` |
| frontend lint, format, typecheck | exit 0; `All matched files use the correct format.`; exit 0 | exit 0; `All matched files use the correct format.`; exit 0 |
| frontend build | `✓ built in 573ms` | `✓ built in 414ms` |
| browser smoke | `7 passed (6.9s)` | `7 passed (6.8s)` |
| Compose and diff | not rerun at baseline | `docker compose config --quiet` and `git diff --check`: exit 0, no output |

The browser suite exercised frontend, local relay, SSH connection, host trust, vault, keyboard, and touch paths. The production JavaScript chunk grew from 589.93 kB / 164.21 kB gzip to 619.09 kB / 173.03 kB gzip, about 5.4% more gzip. This is a build-size check, not a runtime benchmark. The existing Vite 500 kB chunk warning remained one. No new deprecation warnings appeared in tests, builds, or lint. Relay npm ci newly printed an `install-scripts` warning for esbuild, not a deprecation warning.

Docker build failed once this run before building:

```text
ERROR: failed to build: failed to update builder last activity time: open /home/mark/.docker/buildx/activity/.tmp-default1491124326: read-only file system
```

The prior report also recorded this Buildx error for the relay image. No retry or workaround was attempted. `actionlint` was unavailable: `[rtk: No such file or directory (os error 2)]`. Full SHA tag targets were checked with `git ls-remote`, but no release workflow ran.

## Deferred items and notes for the lead

- Run both multi-architecture Docker builds. Smoke the nginx HTTP/WebSocket proxy and production relay on amd64 and arm64. This blocks completion.
- Run the release workflow on GitHub. Check attestation, image publishing, and pinned Action behavior. Static inspection cannot prove these steps.
- Review upstream x/crypto and x/sys commit histories between selected tags. Their package pages establish versions, but full change history was inaccessible. Any unreviewed compatibility finding is SUSPECTED, confidence LOW.
- Prior review R2 remains open: release CI omits Playwright, although this run executed it locally.
- The 5.4% gzip bundle-size rise merits a later performance review if load time matters. Runtime benchmark, iOS hardware, production config, and alternate architecture were not exercised.
