# localssh feature scout

Research accessed 2026-10-31. Scope: browser and mobile SSH clients comparable with localssh's self-hosted, client-side SSH job. Effort and impact are judgments, not measurements. No cross-platform sales ranking was verified.

## Product read

Product: self-hosted browser SSH client for LAN users, core job opening trusted remote shells from any browser without giving the relay credentials or plaintext. LAN audience is stated in `README.md:119-120`; broader audience is SUSPECTED.

Current features, with maturity against the documented behavior:

| Feature | Code evidence | Maturity |
| --- | --- | --- |
| Password-authenticated SSH in Go WASM through a WebSocket-to-TCP relay | `engine/sshclient/client.go:39-55`, `engine/main.go:106-127`, `relay/src/local-relay.ts:140-195` | complete |
| SHA-256 host-key prompt and browser-local remembered fingerprints | `engine/sshclient/client.go:15-22`, `frontend/src/App.tsx:336-345`, `frontend/src/storage/knownHostsStore.ts:3-12` | complete |
| Encrypted saved hosts, usernames, and optional passwords | `engine/vault/document.go:27-65`, `frontend/src/components/SavedHosts.tsx:17-61` | complete |
| Terminal themes, fonts, scrollback, resizing, and full screen | `README.md:26-28`, `frontend/src/components/Terminal.tsx:50` | complete |
| Touch key bar, gestures, and clipboard | `README.md:29-32`, `frontend/src/App.tsx:264-333` | complete |
| One active terminal session in the page | `frontend/src/App.tsx:54-67`, `frontend/src/App.tsx:279-310` | partial for multi-host workflows |
| Public-key authentication and SFTP | `engine/sshclient/client.go:26-37`, `engine/sshclient/client.go:51-55` | stub seam only; neither is exposed |

Constraints: React/Vite/xterm.js, Go WASM, and Node `ws` (`README.md:45-51`, `frontend/package.json:17-28`, `engine/go.mod:5`); browsers need the relay for TCP (`README.md:3-10`); the relay passes encrypted SSH bytes and must not hold credentials (`README.md:3-10`); the vault currently stores only host, port, username, and password in a versioned document (`engine/vault/document.go:27-65`); Docker Compose targets a LAN (`README.md:33-38`, `README.md:119-120`). The README explicitly says there is no application account or credential server (`README.md:36-38`). The project license was not verified from the targeted files read.

## Comparable products

| Product | Why comparable | Verified scope |
| --- | --- | --- |
| [Termius](https://www.termius.com/pricing) | Saved hosts, mobile terminal, local vault, and SSH/SFTP address the same remote-access job. | Official pricing/features page, accessed 2026-10-31; [US iOS App Store listing](https://apps.apple.com/us/app/termius-modern-ssh-client/id549039908), accessed 2026-10-31. |
| [Blink Shell](https://docs.blink.sh/) | Mobile SSH shell with saved hosts, touch keyboard, and key management. | Official current documentation, accessed 2026-10-31. |
| [Prompt 3](https://help.panic.com/prompt/prompt3/) | Mobile and desktop SSH terminal with server list and touch controls. | Official Prompt 3 documentation and [3.5.3 release notes](https://help.panic.com/releasenotes/prompt3/), accessed 2026-10-31. |
| [WebSSH](https://webssh.net/) | Mobile SSH terminal with local credentials and xterm.js rendering, close to localssh's mobile UI. | Official product page and [US App Store listing](https://apps.apple.com/us/app/webssh-sysadmin-toolbox/id497714887), accessed 2026-10-31. WebSSH is native despite its name. |
| [Apache Guacamole](https://guacamole.apache.org/doc/gug/configuring-guacamole.html) | Browser-delivered SSH terminal and SFTP, useful web UX reference. | Official manual v1.6.0, accessed 2026-10-31. Its server handles SSH credentials, so its trust model is not comparable. |
| [Chrome Secure Shell](https://chromium.googlesource.com/apps/libapps/+/HEAD/nassh/docs/hack.md) | WASM SSH in a browser UI, useful technical reference. | Official current developer guide, accessed 2026-10-31. Chrome extension socket privileges make direct TCP behavior non-transferable. |

MobaXterm, SecureCRT, Royal TSX, ShellFish, Tabby, Warp, Wetty, and ttyd were not used as gap authorities. This pass did not verify their current official feature sets. Several target desktop terminal suites, server-side web terminals, or cloud workflows rather than localssh's browser-side, private SSH job. No claim about their sales or popularity follows from that exclusion.

## Demand signals

Signals are observed examples, not population estimates. Reviews describe problems; their proposed features are possible solutions.

| ID | Source, accessed 2026-10-31 | Observed signal and underlying problem | Strength |
| --- | --- | --- | --- |
| D1 | [Prompt 3 US App Store reviews](https://apps.apple.com/us/app/prompt-3/id1594420480?see-all=reviews) | One reviewer could not connect to key-authenticated sites. Problem: password-only clients cannot enter key-only environments. | single mention |
| D2 | [WebSSH Belgian App Store reviews](https://apps.apple.com/be/app/webssh-sysadmin-toolbox/id497714887?platform=iphone&see-all=reviews) | One reviewer needed private-key authentication to log in. Same problem as D1. | single mention |
| D3 | [Termius US App Store reviews](https://apps.apple.com/us/app/termius-modern-ssh-client/id549039908?see-all=reviews) | One reviewer said missing free SFTP left an iPad homelab workflow incomplete. Problem: terminal access alone does not move files. Review is from 2020; [current Termius pricing](https://www.termius.com/pricing) lists SFTP in Starter, so its old paywall claim is not current. | single mention |
| D4 | [WebSSH macOS App Store reviews](https://apps.apple.com/us/app/webssh-sysadmin-toolbox/id497714887?platform=mac&see-all=reviews) | One reviewer said SFTP lacked file details and reliable search. Problem: users need more than a bare transfer button. | single mention |
| D5 | [WebSSH SFTP guide](https://webssh.net/documentation/guides/sftp-file-transfer-iphone/) | Official guide describes browsing, upload, download, and parallel SSH/SFTP use. It establishes shipped capability and workflow, not request volume. | shipped feature |
| D6 | [WebSSH Raspberry Pi guide](https://webssh.net/documentation/guides/raspberry-pi-ssh-ios/) | Official guide gives logs in one terminal and commands in another as a use case. It establishes workflow, not request volume. | shipped feature |
| D7 | [Termius iOS App Store version history](https://apps.apple.com/us/app/termius-modern-ssh-client/id549039908) | Version 7.6.0 added terminal file paste and upload; 7.5.0 improved scrolling and keyboard support. This shows recent investment in mobile file and terminal UX, not measured demand. | shipped features |
| D8 | [Prompt 3 release notes](https://help.panic.com/releasenotes/prompt3/) | Version 3.5.3 fixed clip grouping; 3.5.0 added Bitwarden SSH agent support. This shows ongoing investment in reusable input and key auth, not measured demand. | shipped features |
| D9 | [Termius US App Store reviews](https://apps.apple.com/us/app/termius-modern-ssh-client/id549039908?see-all=reviews) | One reviewer praised host grouping, assigned SSH keys, and tunneling together. Problem: repeat access across several hosts needs low-friction setup. | single mention |

The project's [issues](https://github.com/bradsec/localssh/issues) and [discussions](https://github.com/bradsec/localssh/discussions) were attempted on 2026-10-31 but the web tool returned a cache miss. Search found no indexed localssh request pages. No request totals, reactions, or lack-of-demand claim can be made.

## Gap analysis

| Gap | Comparables with verified capability | Here | Class and demand link |
| --- | --- | --- | --- |
| Private-key SSH authentication | [Blink](https://docs.blink.sh/basics/ssh-keys), [Prompt 3](https://help.panic.com/prompt/prompt-key-security/), [WebSSH](https://webssh.net/documentation/frequently-asked-questions/), [Termius](https://www.termius.com/) | No; `engine/sshclient/client.go:51-55` accepts only `ssh.Password` | TABLE STAKES for key-only access, supported by D1, D2, D9. |
| SFTP browse, upload, download | [Termius](https://www.termius.com/pricing), [Blink](https://docs.blink.sh/advanced/files-app), [WebSSH](https://webssh.net/documentation/guides/sftp-file-transfer-iphone/), [Guacamole](https://guacamole.apache.org/doc/gug/configuring-guacamole.html) | No; retained `*ssh.Client` is a stub seam at `engine/sshclient/client.go:26-37` | TABLE STAKES for mobile file work, supported by D3, D4, D5. Guacamole counts only as web UX evidence. |
| More than one live terminal | [Prompt 3](https://help.panic.com/prompt/prompt-omniview/), [WebSSH](https://webssh.net/documentation/guides/raspberry-pi-ssh-ios/), [Termius](https://www.termius.com/) | No in-page tabs; one `SshHandle` and one `Terminal` at `frontend/src/App.tsx:54-67`, `frontend/src/App.tsx:279-310` | PARITY with a concrete workflow in D6. No cited localssh complaint. |

Existing-feature improvements: the SSH connection flow is partial for key-only hosts (D1, D2); the one-session UI is partial for concurrent logs and commands (D6). SFTP is a new capability, not an existing UI improvement. Other parity gaps without a checked demand signal were dropped.

## Ranked shortlist

Ranking: impact first, then effort, then evidence confidence, then fit with the core shell job. HIGH means two independent checked signals or an adoption-blocking gap; MED means one source type or a clear core-job workflow. Confidence reflects evidence quality, not estimate precision. Effort is inferred from the cited code.

1. K1 | HIGH | M | MED | Private-key SSH authentication | D1,D2,D9 | `engine/sshclient/client.go:39-55`, `engine/main.go:30-49`, `frontend/src/ssh/engine.ts:96-117` | Key-only servers are inaccessible today. Ephemeral key selection needs an additive WASM auth path but no vault change. Effort confidence MED; key format support needs validation. Risk: private-key exposure in JS and auth regressions. Preserve relay protocol and host-key checks.
2. F1 | HIGH | M | MED | SFTP browse, upload, and download | D3,D4,D5,D7 | `engine/sshclient/client.go:26-37`, `engine/main.go:167`, `frontend/src/App.tsx:279-310` | File movement is a repeated mobile SSH workflow; the existing `*ssh.Client` can open a subsystem over the same encrypted connection. Effort confidence MED; browser File APIs and transfer backpressure need design. Risk: remote file overwrite and memory pressure. No relay plaintext change.
3. T1 | MED | M | MED | Multiple live terminal tabs | D6 | `frontend/src/App.tsx:54-67`, `frontend/src/App.tsx:279-310`, `frontend/src/components/Terminal.tsx:50` | Logs and commands can stay open together. Effort confidence HIGH; one-handle state and lifecycle must become per-tab. Risk: WASM session lifecycle, background memory, relay session limits. No data-format change expected.

## Do not build from this pass

- Cloud sync or team vault: [Termius](https://www.termius.com/pricing) and [Prompt](https://help.panic.com/prompt/prompt3/) offer it, but localssh's no-account, no-credential-server boundary (`README.md:36-38`) makes parity a product change; no checked localssh demand.
- Mosh, Eternal Terminal, and persistent background sessions: [Prompt 3](https://help.panic.com/prompt/prompt3/) and [Blink](https://docs.blink.sh/) offer mobile resilience, but these need protocols or infrastructure beyond the TCP byte relay; no checked localssh demand.
- Local browser port forwarding: [Blink](https://docs.blink.sh/advanced/advanced-ssh) and [Termius](https://www.termius.com/pricing) support it, but a page cannot provide a general local TCP listener (`README.md:8-10`); no browser-safe design was verified.
- AI command generation, snippets, logs, and terminal multiplayer: present in [Termius](https://www.termius.com/pricing); no checked adoption blocker for this product, and logs or collaboration would increase privacy and maintenance risk.

## Spec stubs

### K1. Private-key SSH authentication

Building: let a user connect to a key-only SSH host from the browser; done means a supported private key authenticates while existing password login and host-key verification still work.

Problem: D1 and D2 show key-authenticated environments that password-only clients cannot enter. D9 reinforces assigned-key convenience.

Requirements:

1. The connect form accepts a private-key file and passphrase, and rejects malformed or unsupported keys with a specific error.
2. The Go WASM SSH client authenticates with the selected key and still verifies the host key before opening the shell.
3. Existing password and saved-password connections keep working.
4. Key bytes and passphrases never go to the relay, logs, or browser storage.

Test boundary: `sshclient.Connect` at `engine/sshclient/client.go:43`; browser seam `connectSession` at `frontend/src/ssh/engine.ts:96-117`.

Out of scope: FIDO2, agent forwarding, cloud sync, and automatic key installation on remote hosts.

Integration points: `frontend/src/components/ConnectDialog.tsx:47-85`, `frontend/src/ssh/engine.ts:96-117`, `engine/main.go:30-75`, `engine/sshclient/client.go:43-55`.

Frozen: existing password behavior, trusted-host storage format, relay connect frame, and no-server-credentials boundary.

Open question: Which key formats are supported? Assume OpenSSH Ed25519 and RSA first, with clear errors for other formats.

Open question: Should keys persist in the vault? Assume no for this slice; encrypted saved keys require a separate vault migration design.

### F1. SFTP file movement

Building: let a connected user browse a remote directory and move individual files to and from their device; done means a selected local file uploads and a selected remote file downloads intact.

Problem: D3 and D4 show missing or weak SFTP makes mobile administration incomplete. D5 describes the workflow. D7 shows recent investment in file movement.

Requirements:

1. Open SFTP over the existing verified, authenticated SSH connection; the relay receives only the encrypted SSH stream.
2. List remote paths and file name, type, and size; show permission and transport failures.
3. Upload a user-selected browser file and download a user-selected remote file without keeping the whole file in memory when streaming APIs allow it.
4. Confirm before replacing a remote file; never silently overwrite or delete.
5. Closing SFTP does not close the terminal; disconnect closes both channels and cancels transfers.

Test boundary: `sshclient.Session.Client()` at `engine/sshclient/client.go:37`; browser API for SFTP: none found.

Out of scope: directory sync, recursive transfers, remote editor, search, and background transfers after the page closes.

Integration points: `engine/sshclient/client.go:26-37`, `engine/main.go:167`, `frontend/src/App.tsx:279-310`; browser File API in a new view.

Frozen: relay protocol and access policy, host-key checks, vault format, and existing terminal I/O.

Open question: How should large downloads work across target browsers? Assume browser streaming where supported; validate fallback memory limits before shipping.

### T1. Multiple live terminals

Building: let a user keep two or more SSH shells open in one page and switch between them; done means output, input, and disconnect affect only the selected tab.

Problem: D6 documents the logs-plus-commands workflow. No direct localssh request was verified.

Requirements:

1. Opening another host creates another tab without ending current sessions.
2. Each tab retains its own SSH handle, terminal buffer, host label, status, and terminal size.
3. Keyboard input, paste, resize, and disconnect target only the selected tab.
4. Closing the page closes every handle; a closed or failed session does not close sibling tabs.
5. Host-key prompts identify the target tab and block only that connection attempt.

Test boundary: `App` at `frontend/src/App.tsx:54`; browser connection seam `connectSession` at `frontend/src/ssh/engine.ts:96-117`.

Out of scope: split panes, workspace restore, broadcast commands, and cross-device session recovery.

Integration points: `frontend/src/App.tsx:54-67`, `frontend/src/App.tsx:279-345`, `frontend/src/components/Terminal.tsx:50`, `engine/main.go:167`.

Frozen: saved-host and known-host formats, relay frame, and existing single-session behavior when only one tab is open.

Open question: Maximum simultaneous tabs? Assume a modest browser-side cap and show the relay's existing session-limit error; set the cap after a device memory check.

## Research gaps and lead notes

- Project issue and discussion pages returned cache misses on 2026-10-31. No local request count, ranking, or direct user-demand verification exists in this report.
- App Store pages expose selected reviews, not a representative sample. No review frequency or market share was inferred.
- Termius US iOS App Store displayed about 20K ratings and WebSSH about 2.5K on 2026-10-31, but ratings do not establish top sales or a cross-platform popularity order. Other named products' ranking was not checked.
- Current official feature sets of excluded products, browser File API support matrix, private-key parser behavior in the pinned Go crypto version, and repository license were not verified.
- SUSPECTED: localssh users beyond the documented LAN audience may want cross-device vault portability. No checked signal qualifies it as a candidate.
- Concurrent branch edits were present in `frontend/src/vault/useVault.ts` and `frontend/src/vault/vaultStore.ts` plus tests when research began. Recheck those files before building K1; this report did not edit them.
