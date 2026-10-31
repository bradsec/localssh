# Repository health: security review

Reviewed 2026-10-31 on `review/2026-10-31`, HEAD `c1a7b31`. The worktree was clean at entry. This is a source and configuration review of the bundled deployment, not a deployed-system assessment. No branch or commit was created.

## Phase 0: checkpoint, threat model, and execution controls

- Stack: Go 1.27.3 SSH and vault engine compiled to browser WASM; React/Vite frontend; Node 26.13.0 `ws` relay; nginx and Docker Compose.
- Entry points: browser connection and vault forms, clipboard, terminal output, WebSocket upgrade and connect frame, relay environment variables, persisted browser storage, release workflow inputs. There are no application HTTP API routes, queues, or webhooks.
- Trust boundaries: network to browser code, browser to WASM, browser to relay, relay to TCP targets, remote SSH output to terminal, local storage to vault parser, repository to CI and images.
- Authn/authz: no app accounts or relay authentication. Exact browser Origin, target hostname, and target port lists constrain relay use. SSH authenticates to the target, and host keys bind the browser session to a server.
- Secrets: typed passwords live in browser state during connection; saved credentials live in a local encrypted vault; release credentials come from GitHub Actions secrets. The relay should receive no plaintext SSH credentials.
- Manifests: `engine/go.mod` and `go.sum`, `frontend/package.json` and `package-lock.json`, `relay/package.json` and `package-lock.json`, both Dockerfiles, `compose.yaml`, `.env.example`, and `.github/workflows/release.yml`.
- Scanner baseline: frontend `npm audit --audit-level=low`: `found 0 vulnerabilities`; relay: `found 0 vulnerabilities`. `semgrep`, `gitleaks`, and `govulncheck` were unavailable. A targeted working-tree secret-pattern search found no candidate outside dummy test values; git history was not scanned.
- Execution controls: `bwrap` accepted an isolated, read-only root, empty environment, disabled network, scratch `tmpfs`, and process/resource limits. Go tests could not fetch the required toolchain without network. Frontend tests failed at Vitest startup under process limits. No target was run outside the sandbox. No endpoint, account, or shared service was probed.

## Findings

ID | SEVERITY | file:line | actor and input -> control -> boundary crossed -> affected resource | observed result | fix | CONFIDENCE
--- | --- | --- | --- | --- | --- | ---
S-01 | HIGH | `deploy/nginx.conf:2`, `compose.yaml:12`, `README.md:139` | An on-path LAN actor controls the HTTP page or script response -> HTTPS integrity should reject alteration -> network-to-browser code boundary -> the visitor's SSH and vault credentials | The bundled LAN path serves executable client code over HTTP; altered code can read typed SSH and master passwords before the WASM and vault protections apply. The README acknowledges transit modification at line 165. | Propose a trusted HTTPS deployment path and redirect or disable plain HTTP for remote visitors; this changes documented behavior, so no edit was made. | HIGH: the bundled listen port, Compose mapping, documented LAN URL, and password input paths at `frontend/src/components/ConnectDialog.tsx:50-65` and `frontend/src/components/SavedHosts.tsx:65-105` establish the path. [OWASP TLS guidance, accessed 2026-10-31](https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html).

No other confirmed boundary violation was established in the reviewed paths. Severity reflects the demonstrated ability to replace delivered code, not a claim that a deployed LAN was attacked.

## Suspected items, no severity

ID | STATUS | file:line | actor and input -> control -> boundary crossed -> affected resource | missing fact and safe owner check | proposed fix | CONFIDENCE
--- | --- | --- | --- | --- | --- | ---
S-02 | SUSPECTED | `relay/src/access.ts:67-75`, `relay/src/local-relay.ts:187` | A party controlling DNS for an allowed hostname chooses its address -> hostname allowlist should constrain target reachability -> relay-to-target boundary -> internal TCP services | Missing fact: whether any actual `ALLOWED_HOSTS` name or wildcard subdomain is attacker-controlled, and whether egress ACLs restrict resolved addresses. Owner can inspect the deployed allowlist, DNS delegation, and egress rules without sending traffic. | If untrusted DNS is in scope, resolve once, validate every address against an explicit address policy, and dial the validated address while retaining the original SSH hostname. This requires a policy decision and potentially changes accepted targets. | MED: source shows a name check followed by a separate hostname dial; exploitability depends on external DNS and egress facts. [OWASP SSRF guidance, accessed 2026-10-31](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html), [Node 26 DNS documentation, accessed 2026-10-31](https://nodejs.org/api/dns.html).

## Phase 2: roadmap

- S-01: M effort, HIGH fix risk. Add a deployment with trusted TLS for LAN clients and document certificate setup. Preserve the current HTTP mode until the owner approves the user-visible transport change.
- S-02: M effort, MED fix risk if confirmed. Define permitted resolved-address ranges and bind the dial to a validated address. Do not block private addresses generically: localssh explicitly connects to private SSH hosts.

## Phase 3: execution

No application fix was applied. S-01 requires a change to public deployment behavior. S-02 needs deployed DNS ownership and egress facts. This report is the only changed file. There are no finding-to-commit hashes; lead review and commits remain pending.

## Phase 4: verification evidence

| Check | Baseline | Final | Result |
| --- | --- | --- | --- |
| Frontend npm audit | `found 0 vulnerabilities` | `found 0 vulnerabilities` | No reported npm advisory. |
| Relay npm audit | `found 0 vulnerabilities` | `found 0 vulnerabilities` | No reported npm advisory. |
| Go tests, inside sandbox | Not run | `go: download go1.27.3: golang.org/toolchain@v0.0.1-go1.27.3.linux-amd64: Get "https://proxy.golang.org/golang.org/toolchain/@v/v0.0.1-go1.27.3.linux-amd64.zip": dial tcp: lookup proxy.golang.org on 8.8.8.8:53: dial udp 8.8.8.8:53: connect: network is unreachable` | Blocked by missing toolchain and disabled network; no retry. |
| Frontend tests, inside sandbox | Not run | `The global thread pool has not been initialized.: ThreadPoolBuildError { kind: IOError(Os { code: 11, kind: WouldBlock, message: "Resource temporarily unavailable" }) }` | Vitest startup failed under the process limit; no retry. |

No reproduction was run because no fix was applied. `npm ci`, Go WASM vet and build, relay tests/lint/format/build, frontend lint/format/typecheck/build/Playwright, both Docker image builds, and the live release workflow remain unverified in this pass. Docker builds were not attempted because an external daemon would run target build steps outside the required read-only scratch sandbox; the earlier migration report records one Buildx denial. Production proxy, identity, DNS, egress, browser, and secrets rotation were not checked.

## Phase 5: human actions and remaining risks

- S-01: decide whether remote LAN use must require trusted HTTPS. If so, provide certificates, update the deployment and docs, and check that the WebSocket uses `wss:`. No credential rotation is indicated by repository evidence.
- S-02: inspect actual allowlisted DNS names, delegation, and relay egress rules. Decide whether address-level policy is required.
- Run the documented checks in a sandbox with a preloaded Go 1.27.3 toolchain and adequate process capacity. Run both image builds and the release workflow in an approved isolated runner.
- Earlier R2 remains: `.github/workflows/release.yml:101-109` omits the Playwright suite. This is a release-gate gap, not an independently demonstrated attacker boundary crossing.
- Earlier R3 is resolved at the advisory-count level: both current npm audits report zero. Reachability of historical development advisories was never established.
- Git history secret scanning, live security headers, actual proxy TLS, network ACLs, cross-browser terminal behavior, and release attestations remain unverified.

## Hardening notes, no severity

- `deploy/nginx.conf:1-32` sets no CSP or frame policy. No reachable frontend XSS sink was established: reviewed JSX interpolations render text, `frontend/src/components/Terminal.tsx:107` delegates remote output to xterm, and no application use of `innerHTML` or `eval` appeared. A CSP needs validation against WASM, Vite assets, fonts, and WebSocket connections. [OWASP CSP guidance, accessed 2026-10-31](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html).
- `compose.yaml:24-27` defaults `ALLOWED_HOSTS=*`; `README.md:148-154` explicitly documents that wildcard Origin permits other browser pages to dial allowed targets. Restrict both lists when the network is shared. A raw WebSocket client can forge Origin, so it is a browser policy, not user authentication. [OWASP WebSocket guidance, accessed 2026-10-31](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html).
- `relay/src/local-relay.ts:114-125,153-210` has a 1 MiB message limit, 256-session cap, handshake and dial deadlines, and bidirectional backpressure. These mitigate but do not prove availability under hostile sustained connection load. No load test ran.
- `engine/vault/envelope.go:26-33,56-64` and `engine/vault/session.go:29-105` use Argon2id at 64 MiB, three passes, one lane by default, a random 16-byte salt, XChaCha20-Poly1305 with a fresh 24-byte nonce, authenticated metadata, version checking, and size/cost bounds. These settings exceed OWASP's stated Argon2id minimum, but mobile WASM latency remains unmeasured here. [OWASP Password Storage guidance, accessed 2026-10-31](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
- `frontend/src/components/Terminal.tsx:113` uses xterm's paste API, which honors bracketed paste; no OSC 52 clipboard addon is loaded. Remote terminal control-sequence behavior was not exercised. [xterm 6 release notes, accessed 2026-10-31](https://github.com/xtermjs/xterm.js/releases).
- `.github/workflows/release.yml:26-176` pins third-party Actions by full commit SHA. The workflow was inspected but not executed.

## Coverage

| Unit: surface x boundary x attack class | Status | Evidence or limit |
| --- | --- | --- |
| Relay upgrade/connect frame x browser/network-to-relay x auth, validation, proxy access | Covered by source | `relay/src/access.ts`, `protocol.ts`, `local-relay.ts`, `scripts/run-relay.ts`; no live probe. |
| Relay hostname/DNS x relay-to-network x SSRF/rebinding | Covered by source, deferred environment | S-02 needs actual DNS and egress facts. |
| Relay WebSocket/TCP x untrusted peers x limits/backpressure | Covered by source | Static analysis only; no stress test. |
| Browser host trust x remote SSH-to-WASM/browser x impersonation | Covered by source | `engine/sshclient/client.go`, `frontend/src/ssh/engine.ts`, `App.tsx`, known-host store. |
| Vault/local storage x local data-to-WASM x crypto, version, loss | Covered by source | `engine/vault`, `frontend/src/vault`; earlier R1 path revalidated in current source, not rerun. |
| SSH output/clipboard x remote server-to-browser x XSS/terminal injection | Covered by source | `Terminal.tsx`, clipboard component, engine callback; browser behavior untested. |
| HTTP frontend x network-to-browser x script integrity, CSP | Covered by source | S-01; CSP is a hardening note. |
| Dependencies/CI/images x upstream-to-release x known advisories/supply chain | Partly covered | npm audits and static workflow/Dockerfile review; Go scan, images, live workflow deferred. |
| Git history x repository-to-release x secret exposure | Not covered | No history scanner available. |
| Cloud/IAM/identity provider, production ingress/proxy, deployed browser policy | Out of scope | No such config or access was supplied. |

Prior R1 was revalidated against current save/reset and host-key paths but not retested. Prior R2 was carried as a release-gate gap with unchanged workflow source. Prior R3 was rechecked using current npm audit counts. No pass can establish complete coverage.
