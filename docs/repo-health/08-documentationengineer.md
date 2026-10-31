# Documentation audit, 2026-11-01

Status: documentation audit complete on `review/2026-10-31`. The lead's listed uncommitted edits belong to this step. No branch, commit, push, tag, or PR was made. The lead owns commits. Docker deployment and live publication remain unverified.

## Inventory and drift status

| Document | Audience | Drift status |
| --- | --- | --- |
| `README.md` | New user, operator, contributor | Updated for K1, T1, F1, Help, three deployment paths, configuration, security, touch, development, release, and upgrades. Docker runtime unverified. |
| `docs/USER-GUIDE.md` | User | Added for task steps matching `frontend/src/helpTopics.ts:19-131`; source and links checked. |
| `frontend/README.md` | Contributor | Corrected development relay URL and covered Node 26, tabs, SFTP, Help. Local startup checked. |
| `relay/README.md` | Operator, contributor | Updated for combined server, access policy, TLS, and close reasons. Source checked. |
| `engine/README.md` | API consumer, contributor | Updated for key auth, SFTP, callback reason, and build. Engine build checked. |
| `.env.example` comments | Operator | Updated DNS trust and combined Compose scope; compared with `compose.yaml:19-28` and `relay/src/access.ts:33-94`. |
| `compose.yaml` | Operator | Current two-image configuration; `docker compose config --quiet` passed. No comment drift found. |
| `compose.all-in-one.yaml` | Operator | Current single-image example; its config check passed. Fixed values documented. |
| `PRODUCT.md` | Product contributor | Updated K1, T1, F1, and product constraints; compared with current source. |
| `DESIGN.md` | Design contributor | Current design reference; no behavior claim requiring a fix. |
| `engine/main.go`, `engine/remotefiles/remotefiles.go` doc comments | API consumer | Corrected callback surface and replacement warning. No generated reference docs exist. |
| `docs/repo-health/01-codereviewengineer.md` through `07-devopsengineer.md` | Maintainer, lead | Historical dated reports, read for changed behavior; no rewrite. |
| `docs/new-feature/01-featurescout.md` through `08-securityengineer.md` | Maintainer, lead | Historical dated reports, read for K1, T1, F1 and review fixes; no rewrite. |
| `docs/repo-health/08-documentationengineer.md` | Maintainer, lead | Replaced stale stopped report with this audit. |

The last commit touching main docs and current code was `618b816` on 2026-11-01. The drift candidates were uncommitted docs and screenshots after K1, T1, F1, Help, and deployment changes. `screenshot1.png` and `screenshot2.png` now show the key choice, tab bar, and Files panel; both were inspected. No temporary capture spec remains in `frontend/e2e/`.

## Findings

ID | SEVERITY | doc file:line | problem | evidence (code or command, confidence) | fix
--- | --- | --- | --- | --- | ---
DOC-01 | HIGH | `frontend/README.md:50` | Development instructions left frontend on same-origin `/relay` while local relay listens on 8787. | `frontend/src/relayUrl.ts:10-13`, `relay/scripts/run-local-relay.ts:3-12`; HIGH. | Set `VITE_RELAY_WS_URL` in dev command. Fixed.
DOC-02 | HIGH | `README.md:448` | A failed replacement was described as always preserving the previous remote file. | `engine/remotefiles/remotefiles.go:200-211` removes it before fallback rename; HIGH. | State data-loss case and staged-copy recovery; correct Go doc comment. Fixed.
DOC-03 | HIGH | `README.md:15` | Baseline feature and setup text omitted implemented K1, T1, F1, Help, and combined image. | `frontend/src/App.tsx:399-575`, `frontend/src/components/FilePanel.tsx:139-407`, `frontend/src/helpTopics.ts:19-131`, `Dockerfile.all-in-one:1-35`; HIGH. | Update feature list and quickstart; link task guide. Fixed.
DOC-04 | MEDIUM | `README.md:153` | LAN guidance lacked the DNS trust boundary for hostname allowlist entries. | `relay/src/access.ts:67-94`, `relay/src/local-relay.ts:212-219`; HIGH for code path, deployed exploitability unknown. | Document controlled DNS, target IPs, and host egress rules. Fixed.
DOC-05 | MEDIUM | `README.md:244` | Configuration and release docs omitted combined server, TLS variables, Node 26, Quality, and Release. | `relay/scripts/run-all-in-one.ts:9-35`, `.nvmrc:1`, `.github/workflows/quality.yml:1-79`, `.github/workflows/release.yml:3-9`; HIGH. | Add config, development, release, and upgrade sections. Fixed.
DOC-06 | MEDIUM | `engine/README.md:38` | Public example dropped close reason and SFTP handle surface. | `engine/main.go:255-263,330-344`, `engine/sftpjs.go:138-214`; HIGH. | Correct example and bridge doc comment. Fixed.
DOC-07 | MEDIUM | `docs/USER-GUIDE.md:1` | No standalone task guide covered shipped Help, key, tabs, files, and touch flows. | `frontend/src/helpTopics.ts:19-131`, `frontend/src/components/Help.tsx:18-170`; HIGH. | Add guide linked from README. Fixed.
DOC-08 | MEDIUM | `README.md:49` | Old screenshots showed former connection and terminal layout. | `frontend/src/components/ConnectDialog.tsx:52-104`, `frontend/src/App.tsx:399-575`; HIGH. | Replace both captures and inspect them. Fixed.
DOC-09 | MEDIUM | `frontend/src/helpTopics.ts:82` | In-app Help still says every failed replacement keeps the previous remote file. | `engine/remotefiles/remotefiles.go:200-211`; HIGH. | Deferred: Help topic is production source, frozen for this role.
DOC-10 | LOW | `README.md:70` | SUSPECTED: combined GHCR image may not yet be published. | `.github/workflows/release.yml:142,215-231`; LOW, no live registry or workflow run. | Keep command marked untested; verify publication before live deployment.
DOC-11 | MEDIUM | `README.md:230` | Relay logs were said to identify every refusal, including session-limit 503. | `relay/src/local-relay.ts:145-148` returns 503 without logging; HIGH. | Narrow README claims; report matching in-app Help claim for code review. Fixed in README, Help deferred.

## Fix roadmap and files for lead commits

DOC-01 | Correct local dev URL | S | `frontend/README.md`, `README.md`.
DOC-02 | Correct replacement warning | S | `README.md`, `engine/remotefiles/remotefiles.go` doc comment.
DOC-03 | Document shipped features and quickstart | M | `README.md`, `docs/USER-GUIDE.md`.
DOC-04 | Explain DNS and egress boundary | S | `README.md`, `relay/README.md`, `.env.example`.
DOC-05 | Document configuration and workflows | M | `README.md`, `relay/README.md`, `frontend/README.md`, `PRODUCT.md`.
DOC-06 | Correct API example | S | `engine/README.md`, `engine/main.go` doc comment.
DOC-07 | Add task guide | S | `docs/USER-GUIDE.md`.
DOC-08 | Refresh captures | S | `screenshot1.png`, `screenshot2.png`.
DOC-09 | Change in-app Help after code review | S | Deferred by production-code freeze.
DOC-10 | Check published image | S | Deferred until registry or live release check.
DOC-11 | Correct session-limit log claim | S | `README.md`; in-app Help copy deferred by production-code freeze.

## Verification evidence

The final development walkthrough built the engine, installed both npm workspaces under Node 26.13.0, ran their checks, started the local relay and Vite with the documented URL, and fetched the page. The prior frontend command would have used `/relay` on Vite's origin (`frontend/src/relayUrl.ts:10-13`). The corrected startup printed `VITE v8.3.5  ready in 89 ms` and `Local:   http://localhost:5173/`. `curl -fsSI http://localhost:5173/` returned `HTTP/1.1 200 OK`. Both temporary processes were stopped.

Fresh command summary lines, verbatim:

```text
Go test: 101 passed in 5 packages
built dist/engine.wasm, dist/wasm_exec.js, dist/testsshd
added 49 packages, and audited 50 packages in 658ms
added 124 packages, and audited 125 packages in 920ms
found 0 vulnerabilities
Test Files  5 passed (5)
Tests  48 passed (48)
Test Files  30 passed (30)
Tests  333 passed (333)
All matched files use the correct format.
TypeScript: No errors found
✓ built in 163ms
22 passed (10.3s)
Local links and anchors checked: 22; broken: 0
```

`GOOS=js GOARCH=wasm go vet ./...`, both lints, relay build, both `docker compose ... config --quiet` checks, and `git diff --check` exited 0 with no diagnostics. Both format checks printed `All matched files use the correct format.` The 22 Playwright tests exercised SSH through the relay, key login, tabs, SFTP, Help, address book, and touch flows. They did not run a published Docker image.

The local-link check parsed links and Markdown heading anchors across `README.md`, all three component READMEs, `PRODUCT.md`, `DESIGN.md`, and `docs/USER-GUIDE.md`. All 22 relative paths and anchors resolved. Both screenshots were viewed. Final source review checked documented env vars, file names, and ports against `.env.example`, both Compose files, `relay/scripts/`, `frontend/src/relayUrl.ts`, `.nvmrc`, and package manifests.

Commands documented but not executed here: `docker run`, both `docker compose up` forms, `docker compose pull`, `docker compose down`, `docker image prune`, and container removal examples. A prior Buildx attempt failed before building with `read-only file system` under `/home/mark/.docker/buildx/activity/`; the sandbox instruction forbids retries or workarounds. Certificate mounting, LAN firewall changes, physical iOS behavior, GHCR publication, and live Quality or Release runs remain unverified. HTTPS and proxy paths depend on operator certificates and networks.

Current external references accessed 2026-11-01: [Docker run port publishing](https://docs.docker.com/reference/cli/docker/container/run), [Compose interpolation](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation), [Compose up recreation](https://docs.docker.com/reference/cli/docker/compose/up/), [MDN secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts), [MDN Clipboard API](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API), [mkcert README](https://github.com/FiloSottile/mkcert), and [Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy). These are current page scopes; local source supports project behavior.

## Code problems and deferred items

DOC-09 | In-app Help overpromises replacement safety; production code is frozen. The lead should change `frontend/src/helpTopics.ts:82` and its test.
DOC-10 | Published combined-image availability and live workflow execution need registry and GitHub checks. Static workflow source cannot prove publication.
DOC-11 | In-app Help says relay logs distinguish a session limit, but the 503 path does not log. The lead should change `frontend/src/helpTopics.ts:101` or add a log in a code step.
Container walkthrough | A Docker-capable host must build and run all three images, then check HTTP(S), `/relay`, and health status. Exact commands are in `docs/repo-health/07-devopsengineer.md` under “Lead runtime checks”.
Screenshots | Current captures were inspected. No new capture step is needed unless the UI changes again.
