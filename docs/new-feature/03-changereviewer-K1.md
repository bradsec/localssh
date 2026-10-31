# K1 change review

## Change and intent

Range: `b966c0e18448d1603ff096ab0bb93468fb22d951..c60b4c6` on `review/2026-10-31`. The worktree was clean before review. The range changes 22 files, with 896 additions and 49 deletions. No generated file is in the diff.

Change: Add private-key SSH login so users can reach key-only hosts while password login, host-key checks, and relay secrecy remain intact. Intent is stated in `docs/new-feature/01-featurescout.md:81-96` and `docs/new-feature/02-featurebuilder-K1.md`.

## Verdict

CHANGES REQUIRED, K1-1. Confidence HIGH: the advertised PEM path reaches a parser that rejects encrypted PKCS#8 before it tries the supplied passphrase.

## Findings

K1-1 | HIGH | `engine/sshclient/key.go:35` | Encrypted PKCS#8 PEM keys fail with “format not supported” despite the advertised PEM key and passphrase support | Trigger: select an RSA, ECDSA, or Ed25519 `-----BEGIN ENCRYPTED PRIVATE KEY-----` file and enter its correct passphrase; `frontend/src/components/ConnectDialog.tsx:240` advertises PEM, `engine/main.go:123` calls this parser, and the pinned `x/crypto/ssh` parser rejects that PEM block before the passphrase branch at `engine/sshclient/key.go:37` | Support encrypted PKCS#8 before creating the SSH signer, and test correct and wrong passphrases for this format | CONFIDENCE HIGH

Proof: Pinned `golang.org/x/crypto/ssh` v0.58.0 at `/home/mark/go/pkg/mod/golang.org/x/crypto@v0.58.0/ssh/keys.go:1399-1412` accepts `PRIVATE KEY` but sends `ENCRYPTED PRIVATE KEY` to its unsupported-type default. OpenSSL 3.5 documents encrypted PKCS#8 as a normal output format. Sources: [Go SSH v0.58.0](https://pkg.go.dev/golang.org/x/crypto@v0.58.0/ssh#ParseRawPrivateKey), [OpenSSL pkcs8 3.5](https://docs.openssl.org/3.5/man1/openssl-pkcs8/), accessed 2026-11-01. This is a traced path, not a runtime reproduction.

## Callers and sibling paths

Traced `ConnectDialog` to `App.attemptConnect`, `connectSession`, the six-argument WASM `sshConnect`, `resolveAuth`, `sshclient.ParsePrivateKey`, and `ConnectWithKey`. Checked host-key rejection, trust retry, cancellation, key-byte clearing, saved-password selection, and password `Connect`. Checked `NewTestServer`, `AuthorizeKey`, testsshd's optional `authorized_keys` argument, error mapping, Help, README, and relay protocol. No other K1 finding met the concrete-trigger threshold.

## Checks

Commands used Node v26.13.0 for npm. Summary lines below are verbatim command output. All commands exited 0; the WASM vet and TypeScript commands produced no output.

| Scope | Command | Output |
| --- | --- | --- |
| Engine | `go test ./...` | `Go test: 78 passed in 4 packages` |
| Engine | `GOOS=js GOARCH=wasm go vet ./...` | No output, exit 0 |
| Engine | `./build.sh` | `built dist/engine.wasm, dist/wasm_exec.js, dist/testsshd` |
| Frontend | `npm ci` | `added 124 packages, and audited 125 packages in 922ms`; `found 0 vulnerabilities` |
| Frontend | `npm test` | `Test Files  29 passed (29)`; `Tests  295 passed (295)` |
| Frontend | `npm run lint` | `> oxlint` |
| Frontend | `npm run format:check` | `All matched files use the correct format.` |
| Frontend | `npx tsc -b` | No output, exit 0 |
| Frontend | `npm run build` | `✓ built in 515ms` |
| Frontend | `npm run test:e2e -- --reporter=dot` | `20 passed (7.1s)` |
| Relay | `npm ci` | `added 49 packages, and audited 50 packages in 676ms`; `found 0 vulnerabilities` |
| Relay | `npm test` | `Test Files  4 passed (4)`; `Tests  47 passed (47)` |
| Relay | `npm run lint` | `> oxlint src scripts test` |
| Relay | `npm run format:check` | `All matched files use the correct format.` |
| Relay | `npm run build` | `> tsc -p tsconfig.build.json` |
| Range | `git diff --check BASE_K1..HEAD` | No output, exit 0 |

## Not reviewed or verified

Only unchanged test fixture context outside the diff was skimmed. No runtime reproduction of encrypted PKCS#8, physical mobile test, or external SSH server test was run. The browser suite used its generated Ed25519 keys and local relay/testsshd. Route K1-1 to the change author or debugengineer. No whole-repository finding is reported.
