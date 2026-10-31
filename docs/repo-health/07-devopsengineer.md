# CI/CD and Docker review, 2026-11-01

Branch `review/2026-10-31` was clean at entry. No branch, commit, push, tag, release, deploy, secret change, or IaC apply was made. Current HEAD is the rollback point. The lead owns commits.

## Inventory and release path

- Go 1.27.3 (`engine/go.mod:3`) builds the browser WASM engine; Node 26 (`.nvmrc:1`) builds the React/Vite frontend and Node relay. npm lockfiles exist in `frontend/` and `relay/`; `engine/go.sum` locks modules. Tests and builds are the commands in `quality.yml:32-66`.
- Existing `.github/workflows/release.yml:3-9` runs on a `VERSION` change pushed to `main`, or manual dispatch. Validation checks CalVer and an existing git tag. Its test job gates publication of the two existing GHCR images and GitHub release. The edited workflow also publishes `ghcr.io/bradsec/localssh`. All images use CalVer and `latest` tags, amd64 and arm64. Registry writes use only `GITHUB_TOKEN`; no cloud account or IaC stack appears in this repository.
- `compose.yaml:3-28` keeps the two-container deployment and its existing image names, ports, and environment values. `compose.all-in-one.yaml:1-10` is an additive, loopback-bound single-container example. The one-process image serves static files and the `/relay` WebSocket upgrade on one port. The relay still forwards SSH ciphertext only (`relay/src/local-relay.ts:180-251`).
- No repository evidence establishes branch protection, environment approvals, GHCR package settings, runner availability, or actual deployment state. No IaC files, state backend, or cloud credentials were found.

## Findings

ID | SEVERITY | file:line | problem | impact | proposed fix | CONFIDENCE
--- | --- | --- | --- | --- | --- | ---
D-01 | HIGH | `.github/workflows/release.yml:101` (baseline) | Release tests excluded `frontend/e2e/**` (prior R2). | Browser connection regressions could ship. | Add Chromium setup and Playwright to the release gate. Applied at `release.yml:123-125`. | HIGH, manifest and workflow inspected; 22 local browser tests passed.
D-02 | HIGH | `deploy/nginx.conf:2`, `compose.yaml:12` | Bundled LAN HTTP serves executable code without TLS (prior S-01). | An on-path actor could replace code before the browser handles credentials. | Add opt-in TLS to the combined image; keep the existing HTTP default. Applied at `relay/scripts/run-all-in-one.ts:11-20`. | HIGH for baseline path, MED for new runtime until image HTTPS is tested.
D-03 | HIGH | `.github/workflows/release.yml:123-124` (baseline) | Release had no all-in-one image. | The requested single-command deployment could not be published. | Add the combined Dockerfile, image build, attestation, and CalVer/latest promotion. Applied. | HIGH for missing artifact, MED for image behavior until Docker runs.
D-04 | MEDIUM | `.github/workflows/release.yml:3-9` (baseline) | Pushes without a `VERSION` change and pull requests had no repository CI. | Changes lacked an automatic pre-merge check. | Add a read-only Quality workflow for `main` pushes and pull requests. Applied at `quality.yml:1-79`. | HIGH from trigger inspection; live GitHub run unverified.
D-05 | MEDIUM | `frontend/package.json:1-5` (baseline) | Frontend gave no Node requirement while Node below 26 fails Vitest with `bad option: --no-webstorage`. | Contributors and CI could choose an unusable toolchain. | Add `.nvmrc`, frontend `engines`, and setup-node version-file. Applied. | HIGH from prior migration reproduction and local Node 26 test runs.
D-06 | MEDIUM | `Dockerfile:32`, `relay/Dockerfile:22` (baseline) | Neither existing image had a Docker healthcheck. | Runtime health could not be inspected by Docker. | Add HTTP and TCP healthchecks, plus the combined HTTP(S) check. Applied. | MED, syntax inspected; image health status unverified.
D-07 | LOW | `deploy/nginx.conf:1-32` (baseline) | No CSP or frame policy was set. | Browsers lacked a defense against injected scripts and framing; no reachable XSS sink was established. | Add CSP with `wasm-unsafe-eval`, WebSocket connect permission, and frame denial to both servers. Applied. | MED, header unit test and CSP browser run passed; deployed nginx unverified.

Clean areas: release actions were already pinned to full SHAs, release jobs already used least-privilege tokens and `npm ci`, and existing two-image promotion used digest-based `latest` tags (`release.yml:26-28,117-120,144-180,182-188` baseline). No confirmed exposed secret, destructive deploy, cloud/IaC defect, or third-party unpinned privileged action was found.

## Fix roadmap and files for lead commits

D-01 | Add Chromium Playwright gate | M | LOW risk, extra runner time | `.github/workflows/release.yml`, `frontend/playwright.config.ts`.
D-02 | Optional TLS on same HTTP/WebSocket port | M | MED risk, mounted key permissions and reverse proxy origins need runtime checks | `relay/scripts/run-all-in-one.ts`, `Dockerfile.all-in-one`.
D-03 | Single Node image, CalVer and latest, labels, cache, attestation | M | MED risk, new GHCR artifact and `latest` tag; existing consumers keep their paths | `Dockerfile.all-in-one`, `.dockerignore`, `.github/workflows/release.yml`, `compose.all-in-one.yaml`.
D-04 | PR and main quality gate, local image smoke | M | LOW risk, runner duration and Docker availability | `.github/workflows/quality.yml`.
D-05 | Single Node major source | S | LOW risk | `.nvmrc`, `frontend/package.json`, both workflows.
D-06 | Healthcheck each image | S | LOW risk, runtime status not yet observed | `Dockerfile`, `relay/Dockerfile`, `Dockerfile.all-in-one`.
D-07 | CSP and framing headers | S | MED risk for browser compatibility | `deploy/nginx.conf`, `relay/src/web-server.ts`, `relay/src/web-server.test.ts`.

The shared-server integration is in `relay/src/local-relay.ts`, `relay/src/web-server.ts`, `relay/scripts/run-all-in-one.ts`, and `relay/tsconfig.build.json`. `README.md` received only the requested deploy stub. No commit hash exists; each ID maps to files above.

## Verification evidence

| Check | Baseline | Final |
| --- | --- | --- |
| actionlint, release workflow | Exit 0, stdout empty, 0 findings | Both workflows: exit 0, stdout empty, 0 findings. Shellcheck embedded-script findings: 0. |
| hadolint | Not installed | Not executable; Dockerfile findings cannot be counted. |
| standalone shellcheck | `engine/build.sh`: exit 0, stdout empty | No shell file changed. |
| Docker build | `ERROR: failed to build: failed to update builder last activity time: open /home/mark/.docker/buildx/activity/.tmp-default3820988520: read-only file system` | Not retried after denial. |
| Docker run | `docker: Error response from daemon: pull access denied for localssh, repository does not exist or may require 'docker login'` | No image existed after build denial. Not retried. |
| Compose validation | Existing and new files: exit 0, stdout empty | Same. |
| IaC validation/plan | No IaC in repository | Not applicable; no add/change/destroy plan. |

Fresh checks after edits produced these exact summary lines:

```text
Go test: 101 passed in 5 packages
Go test: 101 passed in 5 packages
built dist/engine.wasm, dist/wasm_exec.js, dist/testsshd
Test Files  5 passed (5)
Tests  48 passed (48)
All matched files use the correct format.
Test Files  30 passed (30)
Tests  333 passed (333)
All matched files use the correct format.
✓ built in 157ms
22 passed (9.1s)
found 0 vulnerabilities
found 0 vulnerabilities
Your code is affected by 0 vulnerabilities.
```

The first `E2E_COMBINED=1` run failed because its built frontend used `/relay` and the test SSH server chose a random port outside `ALLOWED_PORTS=22`. The test config now points the CSP-hosted page at the test relay. The corrected 22-test run passed, including an SSH session. This proves CSP compatibility and browser behavior, but not a browser SSH session through the combined image's `/relay` path. `relay/src/web-server.test.ts` separately proves the shared `/relay` WebSocket upgrade and same-origin rejection. Native and WASM govulncheck each found one module-level entry outside called code.

`go vet ./...`, `GOOS=js GOARCH=wasm go vet ./...`, frontend typecheck, frontend and relay lint, frontend and relay build, `git diff --check`, and both Compose validations exited 0 with no findings. `npm ci` succeeded in both packages. Docker image size before/after, health status, HTTPS, and live CI remain unverified.

## Lead runtime checks

The Buildx denial blocks image verification here. Run these on a Docker-capable host, without pushing or deploying until review:

```bash
docker build -f Dockerfile -t localssh-frontend:smoke .
docker build -f relay/Dockerfile -t localssh-relay:smoke relay
docker build -f Dockerfile.all-in-one -t localssh:smoke .
docker image inspect localssh-frontend:smoke localssh-relay:smoke localssh:smoke --format '{{.RepoTags}} {{.Size}}'
docker run -d --name localssh-smoke -p 127.0.0.1:19080:80 localssh:smoke
docker inspect --format '{{.State.Health.Status}}' localssh-smoke
curl -fsS http://127.0.0.1:19080/healthz
curl -fsSI http://127.0.0.1:19080/ | rg -i 'content-security-policy|x-frame-options|x-content-type-options'
curl -fsSI http://127.0.0.1:19080/engine.wasm | rg -i 'content-type: application/wasm'
docker rm -f localssh-smoke
```

For the combined WebSocket SSH path, keep this test server running in one terminal and copy its printed port:

```bash
cd engine
./build.sh
tail -f /dev/null | ./dist/testsshd tester s3cret
```

In another terminal, set `SSH_PORT` to that printed port, then run these commands:

```bash
SSH_PORT=REPLACE_WITH_PRINTED_PORT
docker run -d --name localssh-ssh-smoke --network host -e PORT=19080 -e ALLOWED_PORTS="$SSH_PORT" localssh:smoke
docker inspect --format '{{.State.Health.Status}}' localssh-ssh-smoke
cd relay
SSH_PORT="$SSH_PORT" node --input-type=module -e 'import WebSocket from "ws"; const ws = new WebSocket("ws://127.0.0.1:19080/relay", { origin: "http://127.0.0.1:19080" }); ws.on("open", () => ws.send(JSON.stringify({host:"127.0.0.1",port:Number(process.env.SSH_PORT)}))); ws.on("message", data => { if (!data.toString().startsWith("SSH-")) process.exitCode=1; else console.log(data.toString().trim()); ws.close(); }); ws.on("error", error => { console.error(error); process.exitCode=1; });'
```

Open `http://127.0.0.1:19080`, connect to `127.0.0.1:$SSH_PORT` with `tester` / `s3cret`, accept the test host key, and verify echoed terminal input. Inspect browser DevTools for CSP violations and a `/relay` WebSocket request. This uses a local test server, not a production host. Clean up with `docker rm -f localssh-ssh-smoke`.

For opt-in TLS, create a throwaway self-signed certificate, mount both files readably for the container's `node` user, and test the same port:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=localhost' -keyout /tmp/localssh.key -out /tmp/localssh.crt
docker run -d --name localssh-tls --network host --user "$(id -u):$(id -g)" -e PORT=19443 -e ALLOWED_PORTS="$SSH_PORT" -e TLS_CERT_FILE=/certs/cert.pem -e TLS_KEY_FILE=/certs/key.pem -v /tmp/localssh.crt:/certs/cert.pem:ro -v /tmp/localssh.key:/certs/key.pem:ro localssh:smoke
docker inspect --format '{{.State.Health.Status}}' localssh-tls
curl -kfsS https://127.0.0.1:19443/healthz
curl -kfsSI https://127.0.0.1:19443/ | rg -i 'content-security-policy|x-frame-options'
cd relay
SSH_PORT="$SSH_PORT" node --input-type=module -e 'import WebSocket from "ws"; const ws = new WebSocket("wss://127.0.0.1:19443/relay", { origin: "https://127.0.0.1:19443", rejectUnauthorized: false }); ws.on("open", () => ws.send(JSON.stringify({host:"127.0.0.1",port:Number(process.env.SSH_PORT)}))); ws.on("message", data => { if (!data.toString().startsWith("SSH-")) process.exitCode=1; else console.log(data.toString().trim()); ws.close(); }); ws.on("error", error => { console.error(error); process.exitCode=1; });'
```

The TLS healthcheck follows `PORT`. Keep the test SSH server running for this check. Load `https://127.0.0.1:19443` in a browser after trusting the throwaway certificate, then verify the browser uses `wss:` for `/relay`. Clean up with `docker rm -f localssh-tls`.

## Human actions and documentation handoff

- Review and commit each logical fix, then merge after a branch Quality run. Set Quality as a required check if desired; repository settings were unavailable. Run a release workflow only after reviewing the final image names and tags.
- No secret rotation is indicated by repository evidence. No IaC apply is needed.
- Documentation step: expand the README deploy stub and a deploy guide. Explain the default HTTP loopback command, LAN exposure and secure-context clipboard limit, `mkcert` or local CA trust on every client, Caddy or another reverse proxy as a trusted TLS option, and the same-port HTTPS/WSS mount. Document `TLS_CERT_FILE`, `TLS_KEY_FILE`, and `STATIC_ROOT` (test/development override), plus new `.nvmrc`, `Dockerfile.all-in-one`, `compose.all-in-one.yaml`, and `.github/workflows/quality.yml`. The old Compose and its env names remain supported.
- `S-02` remains SUSPECTED: DNS control and egress policy for deployed `ALLOWED_HOSTS` are unknown. No cloud setting was inspected.

## Current source checks

Primary sources accessed 2026-11-01: [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) for triggers, permissions, and concurrency; [setup-node v7 README](https://github.com/actions/setup-node/blob/v7/README.md) for `.nvmrc` and npm cache inputs; [Docker GitHub Actions cache](https://docs.docker.com/build/cache/backends/gha/) for scoped cache syntax; [metadata-action v6.2.0](https://github.com/docker/metadata-action/tree/v6.2.0) for raw CalVer tags and OCI labels; [Go vulnerability tooling](https://pkg.go.dev/golang.org/x/vuln/scan) for GOOS/GOARCH environment; [MDN connect-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/connect-src) for WebSocket policy; [MDN CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP) for WASM and script policy; [MDN clickjacking](https://developer.mozilla.org/en-US/docs/Web/Security/Attacks/Clickjacking) for frame denial. The goyt [Quality](https://github.com/bradsec/goyt/blob/main/.github/workflows/quality.yml) and [Release](https://github.com/bradsec/goyt/blob/main/.github/workflows/release.yml) shapes were read on 2026-11-01; this repository retains full-SHA pins and attestation gates.

## Post-review fixes

- Same-origin relay handshakes now restrict page Host names and support `PUBLIC_HOSTS` for owner-controlled domains.
- DOC-11: session-limit HTTP 503 refusals now appear in the relay log.
- DOC-09: in-app Help now states the failed replacement risk without atomic rename.
