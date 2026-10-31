# New features: security review (K1, T1, F1)

Reviewed 2026-11-01 on `review/2026-10-31`, HEAD `847058e`, diff range `b966c0e..HEAD`. The worktree was clean at entry. Mode: fix. I found no CRITICAL, HIGH, or MEDIUM issue and applied no code change. This report is the only changed file. Prior report `docs/repo-health/03-securityengineer.md` (S-01 HTTP delivery, S-02 DNS rebinding via relay) is not repeated; neither changed in this range (relay diff is a test formatting change only).

## Phase 0: threat model

- Stack: Go 1.27.3 engine (x/crypto/ssh v0.58.0, pkg/sftp v1.13.12) compiled to WASM; React/Vite frontend; Node 26 `ws` relay.
- New entry points: private-key file input, pasted key textarea, passphrase input (`frontend/src/components/ConnectDialog.tsx:68-97`); `sshConnect` auth object (`engine/main.go:61-85`); per-tab handles; SFTP `list`, `upload`, `download`, `cancel`, `close` (`engine/sftpjs.go:162-214`); remote directory names, sizes, and file contents from the SSH server; OPFS download copies (`frontend/src/components/FilePanel.tsx:61-125`).
- Trust boundaries: user to page (same principal); SSH server to engine and DOM (lower trust: a host-key-verified server can still be malicious or compromised); engine shared by all tabs in one page (cross-tab availability); page to origin storage.
- Authn/authz: SSH password or public key to the server; host-key pinning per `host:port`; no app accounts. The relay sees only SSH ciphertext, including SFTP, which runs inside the same SSH connection.
- Secrets: key bytes and passphrase live in JS memory until handed to the engine; Go parses, then clears its byte copies (`engine/main.go:122-127`). Nothing key-related is written to `localStorage` (only settings and the vault blob are written: `frontend/src/storage/settingsStore.ts:58`, `frontend/src/vault/vaultStore.ts:76`).
- Scanner baseline (no code changed, so baseline equals final): frontend `npm audit`: `found 0 vulnerabilities`; relay `npm audit`: `found 0 vulnerabilities`; govulncheck: `Your code is affected by 0 vulnerabilities.` with one module-level, not-called entry `GO-2026-5932` (x/crypto `openpgp`, no fix; the engine imports only `x/crypto/ssh`). Source: [pkg.go.dev/vuln/GO-2026-5932](https://pkg.go.dev/vuln/GO-2026-5932), accessed 2026-11-01, all x/crypto versions. semgrep and gitleaks were not run.
- Execution: engine `go test ./...` on loopback only. No external host was contacted except the Go vulnerability database and module proxy.

## Findings

ID | SEVERITY | file:line | actor and input -> control -> boundary crossed -> affected resource | observed result | fix | CONFIDENCE
--- | --- | --- | --- | --- | --- | ---
NF-1 | LOW | `engine/remotefiles/remotefiles.go:74`, pkg/sftp v1.13.12 `client.go:379-430` | Malicious SSH server answers READDIR with an endless stream of names after the user opens Files -> no entry or byte cap on the listing (each packet is capped at 256 KiB by `packet.go:21,380`, the total is not) -> server to the shared WASM engine -> memory of the page, so every other tab's session | Source shows `ReadDirContext` appends until EOF; `List` then builds a JS array and React renders one `<li>` per entry. Not executed. Legitimate 100k-entry folders also render slowly. | Propose: cap entries (for example 10,000) using `ReadDirContext` with a cancelling context and report "listing truncated". Changes visible behavior, so not applied. | MED
NF-2 | LOW | `engine/remotefiles/remotefiles.go:243-244`, `frontend/src/components/FilePanel.tsx:80-87` | Malicious SSH server reports a small Stat size, then returns data without EOF on READ, after the user selects Download -> no bound on bytes written beyond the stat size on the OPFS path (the in-memory fallback stops at 16 MiB, line 116) -> server to browser origin storage -> device disk up to the browser's origin quota | Source shows `WriteTo` streams until EOF; percent climbs past 100 and the user can cancel; the copy is removed on release, timer, or next sweep. Not executed. | Propose: fail when written exceeds the stat size by a margin, or stop at the stat size. Files that grow during download (logs) would change behavior, so not applied. | MED

No other confirmed boundary violation was established in the new code.

## Builder's suspected items, revalidated

- `write`/`resize` on a released session handle returning undefined: refuted for the current UI. `finishClose` calls `onClose` before releasing funcs (`engine/main.go:330-343`), and `onClose` sets `tab.handle = null` (`frontend/src/App.tsx:234`) before any release. The only paths where `onClose` returns early (`App.tsx:233`) are tabs already removed from `tabsRef`, which have no rendered terminal and no input path. Input goes only to the active tab (`App.tsx:136-138`, `553-555`). Dropped. HIGH confidence from source.
- `pagehide` with back-forward cache breaking "Save download": refuted as a reachable state. App's `pagehide` handler closes every session (`App.tsx:120-125`), `onClose` removes the tabs, and `FilePanel` renders only while `tab.handle` is set (`App.tsx:571`), so after restore neither the panel nor the link exists. This is a functional point (the user reconnects), not a security issue. MED confidence: source only, not run in a browser.

## Per-area results

- K1 key handling: no logging of key, passphrase, or auth errors beyond the typed error string (`console.*` calls in new code log only OPFS errors). Error text wraps x/crypto parse errors (`engine/sshclient/key.go:51,53`), which carry ASN.1 or PEM structure info, not key bytes. Key bytes are zeroed in JS on success, failure, cancel, closed tab, and trust failure (`frontend/src/ssh/engine.ts:220,232`; `App.tsx:273,290,305,317,336,620`). No issues found.
- T1 per-tab isolation: each tab has its own `sessionBridge`, write queue, SFTP bridge, and output closure (`App.tsx:221-231`); host-key pending state is bound to `tabId`. No cross-tab input or output routing found. No issues found.
- F1 path and filename handling: remote names reach the DOM only as React text and the `download` attribute (`FilePanel.tsx:55,400`); no HTML sinks (`dangerouslySetInnerHTML`, `innerHTML`, `eval`) exist in `frontend/src`. Bidi and control code points are escaped for display and save names (`frontend/src/remoteFiles.ts:11-19`). A server-supplied name with `/` or `..` only directs further requests to the same server, which already controls its own files. Upload target names come from the local `File.name`. Upload stages to a random 128-bit temp name with `O_EXCL` (`remotefiles.go:140-145`), refuses existing targets without consent (`:136-137,175-177`), and does not follow a symlink on replace. No issues found beyond NF-1 and NF-2.
- Relay session limits: unchanged (`relay/src/local-relay.ts:22,139`, global cap 256). More tabs per page do not change the bound, since a raw WebSocket client could already open 256. No issues found.

## Phase 2 and 3

- NF-1: S effort, LOW fix risk; needs a product decision on truncation copy. Not applied.
- NF-2: S effort, LOW fix risk; needs a decision on growing files. Not applied.

Fixes applied: none. Files changed: `docs/new-feature/08-securityengineer.md` only.

## Phase 4: verification

- Engine `go test ./...`: `ok  	engine/remotefiles`, `ok  	engine/sshclient`, `ok  	engine/vault`, `ok  	engine/writequeue` (cached results at HEAD; no source change since).
- govulncheck: `Your code is affected by 0 vulnerabilities.`
- npm audit frontend and relay: `found 0 vulnerabilities` each.
- Not run this pass, because no code changed: wasm vet, `./build.sh`, frontend and relay tests, lint, format, build, tsc, Playwright. The lead reported them green at HEAD in `06-featurebuilder-F1.md`.
- Not verified: NF-1 and NF-2 against a hostile SFTP server; bfcache behavior in a real browser; heap residue of key material in a browser memory snapshot.

## Human actions

None for secrets: no secret was found in the diff (test keys under `engine/sshclient/testdata/` and the `tester`/`s3cret` Playwright credentials are dummy fixtures). Decide on NF-1 truncation and NF-2 size policy.

## Hardening notes, no severity

- Pasted key text and the passphrase are JS strings in React state (`ConnectDialog.tsx:57-58`) and in `status.pending` during host-key confirmation; strings cannot be wiped. The Go side also creates an unclearable string from the passphrase (`engine/main.go:75`) and keeps the parsed signer for the session. Inherent to the platform; the docs claim only that nothing is saved, which holds.
- A new connection started while a host-key prompt is pending (after "switch to another terminal") replaces `status` at `App.tsx:201` without zeroing the pending key bytes; they wait for GC.
- Key file size is unbounded before `arrayBuffer()` (`ConnectDialog.tsx:78`) and `make([]byte, byteLength)` (`engine/main.go:73`); a mistaken multi-GB selection could exhaust the page. A 64 KiB cap would be safe.
- Replace copies setuid, setgid, and sticky bits onto the uploaded file (`remotefiles.go:183`). If the replaced file was setuid and owned by another user, the result is a setuid file owned by the uploader. Consider copying only permission bits.
- The stale temp sweep removes any regular file named `.localssh-upload-*` older than 24 hours in a listed directory (`remotefiles.go:87`), including another user's in a shared writable folder where permissions allow.
- On servers whose SFTP rename overwrites (for example pkg/sftp-based servers), a file created between `Lstat` and `Rename` is replaced without the prompt (`remotefiles.go:129,171`). OpenSSH refuses such a rename.

## Coverage

Unit | Status
--- | ---
Key input, auth object, parse errors x user-to-engine x secret exposure, logging | Covered by source
Key auth x engine-to-server x auth downgrade, error mapping | Covered by source
Tabs x shared engine x cross-session input/output, host-key binding | Covered by source
SFTP listing x server-to-DOM x injection, spoofing, exhaustion | Covered by source (NF-1)
SFTP download x server-to-origin-storage x filename, exhaustion | Covered by source (NF-2)
SFTP upload x user-to-server x overwrite, symlink, temp races | Covered by source
Relay x multi-tab x session limits | Covered by source, unchanged
Dependencies x Go and npm advisories | Covered by govulncheck and npm audit
Git history secrets, deployed headers, live hostile-server tests | Not covered

Prior S-01 and S-02 were carried unchanged: their source (`deploy/nginx.conf`, `relay/src/access.ts`, `relay/src/local-relay.ts`) did not change in this range. No pass establishes complete coverage.
