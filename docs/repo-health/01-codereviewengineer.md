# Repository health: code review

Reviewed 2026-10-31 on `review/2026-10-31`. No checkpoint commit or new branch was created, as requested. The worktree was clean at entry. Scope assumes a LAN service with multiple browser users and up to 256 relay sessions, as configured in `compose.yaml:28` and described in `README.md:116-152`.

## Language and toolchain inventory

Project configuration and installed tools take precedence over general style guidance. Sources below were accessed 2026-10-31. Generated output, lockfile bodies, bundled fonts, and screenshots were excluded from style findings.

| Language or format | Maintained locations | Target or observed version | Standards source and scope |
| --- | --- | --- | --- |
| Go | `engine/**/*.go`, tests, WASM build | `go.mod`: 1.27.0; local `go version go1.27.0 linux/amd64` | [Effective Go, formatting and naming](https://go.dev/doc/effective_go), official guidance; `gofmt` and `go vet` are the local checks. |
| TypeScript and TSX | `frontend/src`, `frontend/e2e`, `frontend/playwright`, `relay/src`, scripts and tests | `typescript` 7.0.2 in both manifests; frontend target ES2023, relay target ES2022 | [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro), compiler behavior; project `tsconfig` strict options and `oxlint`/`oxfmt` govern checks. |
| JavaScript and MJS | `frontend/scripts/copy-engine.mjs`, browser output from TS, npm scripts | Node 24 in CI and relay manifest; local Node 24.16.0 used for checks | [ECMA-262, 2026 edition](https://ecma-international.org/publications-and-standards/standards/ecma-262/), language syntax. |
| CSS | `frontend/src/app.css`, bundled font CSS | CSS module versions not pinned; `oxfmt` 0.65.0 | [CSS Syntax Level 3](https://www.w3.org/TR/css-syntax-3/), syntax; project formatter governs layout. |
| HTML | `frontend/index.html`, JSX output | Living standard; no fixed project version | [WHATWG HTML Standard](https://html.spec.whatwg.org/multipage/), syntax and semantics. |
| Bash | `engine/build.sh`, inline release workflow scripts | Local Bash 5.2.37; CI Bash version unknown | [GNU Bash manual, shell scripts](https://www.gnu.org/s/bash/manual/html_node/Shell-Scripts.html); CI runner version remains unknown. |
| YAML and Compose | `compose.yaml`, `.github/workflows/release.yml` | YAML dialect/version not pinned; Docker CLI 29.9.2 observed | [YAML 1.2.2](https://yaml.org/spec/1.2/), [Compose specification](https://docs.docker.com/reference/compose-file/), [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax). |
| Dockerfile and nginx config | both Dockerfiles, `deploy/nginx.conf` | Go image 1.27.0, Node image 24, nginx image 1.29; exact image digests unknown | [Dockerfile reference](https://docs.docker.com/reference/dockerfile), [nginx proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html). |
| JSON | package manifests, TypeScript configs, vault and relay wire data | [RFC 8259](https://www.rfc-editor.org/info/rfc8259/); no project JSON version | JSON syntax and interchange. Lockfiles are generated. |
| Markdown and dotenv | README files, `.env.example` | [CommonMark 0.31.2](https://spec.commonmark.org/); dotenv dialect unknown | Documentation only. Compose interpolation is defined by the Compose specification. |

No project file or formatter sets a file or function line limit. Largest maintained files measured: `frontend/src/app.css` 1,719 lines, `frontend/src/App.test.tsx` 520, `frontend/src/components/Terminal.tsx` 514, `engine/wsconn/wsconn.go` 402, `.github/workflows/release.yml` 197, `README.md` 494. Largest reviewed functions: `App` about 294 lines, `attachGestures` about 257, `startLocalRelay` about 141. Their responsibilities and tests, not length alone, were assessed. No size finding was justified.

## Risk map and review depth

| Area | Risk | Depth and result |
| --- | --- | --- |
| Relay handshake, policy, protocol and TCP flow | High: untrusted WebSocket input and network reachability | Deep read of `relay/src/{access,protocol,local-relay}.ts`, callers, and tests; 38 tests passed. No confirmed defect in this pass. |
| Vault data and writes | High: credential loss and cross-tab races | Deep read of Go vault code, JS bridge, frontend store/hook, callers, and tests; R1 found and fixed. |
| SSH and WASM transport | High: host-key boundary, cancellation, concurrency | Deep read of `engine/main.go`, `sshclient/client.go`, `wsconn/wsconn.go`, `writequeue/writequeue.go`; native tests, race test, and WASM vet passed. No confirmed defect in this pass. |
| Browser connection and storage | High: host trust and local persistence | Deep read of `App.tsx`, `ssh/engine.ts`, known-host store and database; unit and browser tests passed. No confirmed defect in this pass. |
| Terminal touch, clipboard and UI | Medium: interaction and accessibility | Targeted read of `Terminal.tsx`, `ClipboardMenu.tsx`, gesture references, and browser test results. Detailed iOS hardware and visual review belongs to the later UI step. |
| CI, Docker and docs | Medium: release integrity | Read manifests, workflow, Dockerfiles, Compose, nginx and READMEs; R2 found. Image builds and live release were not run. |

Static search and project checks swept the remaining maintained source, test, config and script files. Manual line-by-line review did not cover the other `frontend/src/components/*` files, most `frontend/src/**/*.test.*`, `frontend/src/app.css`, font CSS, `relay/test/*`, or every `engine/**/*_test.go`; they are covered by passing checks but need focused UI, security, or release review where noted. Generated and vendored files were out of scope.

## Findings

ID | SEVERITY | file:line | problem | impact | evidence/source | proposed fix | CONFIDENCE
--- | --- | --- | --- | --- | --- | --- | ---
R1 | CRITICAL | `frontend/src/vault/vaultStore.ts:80` | Before this fix, reset removed the vault without comparing the blob that the tab had seen. | A stale tab could delete a newer save or password change from another tab. | `frontend/src/vault/useVault.ts:167-175` caller and red tests in `vaultStore.test.ts:118-125`, `useVault.test.ts:289-301`; code evidence. | Compare the expected blob under the existing IndexedDB write lock and preserve the tab's initial blob. Applied. | HIGH
R2 | MEDIUM | `.github/workflows/release.yml:101` | Release checks call `npm test`, which excludes `frontend/e2e/**`. | A browser connection, touch, or vault regression can pass CI and ship. | `frontend/package.json:13-14`, `.github/workflows/release.yml:103-109`; project configuration. | Run Playwright browser tests in the release test job with browser setup. Defer to the DevOps step. | HIGH
R3 | LOW | `frontend/package.json:42` | SUSPECTED: the development toolchain contains advisory-flagged versions, including `oxfmt`'s `tinypool`. | A developer or CI process could be exposed if attacker-controlled options reach the vulnerable worker path; no such path was established here. | `npm audit --json`: frontend 7 and relay 6 development findings, production 0; [GHSA-85c8-ppgw-ccpr](https://github.com/advisories/GHSA-85c8-ppgw-ccpr), accessed 2026-10-31, requires polluted prototype and a caller-supplied options object. | Trace reachability and update affected lockfiles with compatibility checks in the security step. | LOW

No change needed for Go, JavaScript, CSS, HTML, Bash, YAML, Dockerfile, nginx, JSON or Markdown conventions based on the checks and review scope above. No confirmed HIGH finding.

## Fix roadmap

- CRITICAL R1: compare-and-delete under the existing lock, effort S, fix risk LOW. Applied.
- MEDIUM R2: add the existing `test:e2e` command to CI with a browser install, effort M, fix risk MEDIUM due runner time and browser dependencies. Deferred to DevOps.
- LOW R3: verify reachability, then upgrade affected development dependencies without changing production packages, effort M, fix risk MEDIUM due toolchain version changes. Deferred to security review.

## Fixes and documentation

- R1: `frontend/src/vault/vaultStore.ts`, `frontend/src/vault/useVault.ts`, their two focused test files, `README.md`, and `frontend/README.md`. All changes remain uncommitted. No changelog exists in the repository.

## Test and tool evidence

- Baseline `rtk go test ./...`: `Go test: 55 passed in 4 packages`.
- Baseline relay `rtk env PATH=/home/mark/.nvm/versions/node/v24.16.0/bin:$PATH npm test`: `Test Files  4 passed (4)`; `Tests  38 passed (38)`.
- Baseline frontend, same command: `Test Files  26 passed (26)`; `Tests  242 passed (242)`.
- R1 red test run: `Test Files  2 failed (2)`; `Tests  2 failed | 32 passed (34)`. Failures: `AssertionError: expected "vi.fn()" to be called with arguments: [ 'original' ]` and `AssertionError: promise resolved "undefined" instead of rejecting`.
- R1 focused green run: `Test Files  2 passed (2)`; `Tests  34 passed (34)`.
- Final `rtk go test ./...`: `Go test: 55 passed in 4 packages`. Final relay: `Test Files  4 passed (4)`; `Tests  38 passed (38)`. Final frontend: `Test Files  26 passed (26)`; `Tests  244 passed (244)`.
- Browser check `npm run test:e2e`: `7 passed (7.2s)`. It was not run before the fix, so no browser baseline comparison exists.
- Frontend `npm run lint`: exit 0; `npm run format:check`: `All matched files use the correct format.`; `npx tsc -b --pretty false`: exit 0; `npm run build`: `✓ built in 189ms`, with a 500 kB chunk warning.
- Relay `npm run lint`: exit 0; `npm run format:check`: `All matched files use the correct format.`; `npm run build`: exit 0.
- `rtk go test -race ./...`: `Go test: 55 passed in 4 packages`; native and WASM `go vet ./...`: exit 0; `gofmt -l`: no paths; `bash -n engine/build.sh`: exit 0; `docker compose config --quiet`: exit 0; `git diff --check`: exit 0.
- `npm audit --omit=dev --json`: 0 production vulnerabilities in frontend and relay. Full audit: frontend 2 moderate, 3 high, 2 critical; relay 2 moderate, 2 high, 2 critical. These are advisory ratings, not the R3 severity.

## Remaining risks and unverified work

- R2 remains open for the DevOps step. The release workflow was read but not run on GitHub.
- R3 remains suspected until toolchain reachability and dependency upgrades are checked. No production npm advisory appeared in the audit output.
- Docker image build, container runtime behavior, GitHub release publication, and actionlint were not run. The installed `actionlint` command was unavailable.
- iOS hardware touch, selection and clipboard behavior was not verified. Chromium Playwright covered the existing seven browser cases.
- Deeper security analysis of the relay, WebAssembly memory and dependency graph remains for the security step; no additional confirmed defect is asserted here.

## Notes for the lead

Files changed: the six R1 files above and this report. Checks run: native and browser tests, race test, vet, lint, format, type check, builds, Compose validation and npm audits. No public application API or configuration format changed. Remaining release and security work is R2 and R3.
