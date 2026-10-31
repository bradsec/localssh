# K1 Private-key SSH authentication: featurebuilder report (PARTIAL)

BASE_K1: b966c0e18448d1603ff096ab0bb93468fb22d951

Status: PARTIAL. Work stopped at the engine layer because the session usage limit was near. Engine pieces are done and green; WASM bridge, frontend, help, e2e, and docs are not started.

## 1. Spec read and assumptions

Building: private-key login for users of key-only SSH hosts, done means a supported key (Ed25519, ECDSA, RSA, passphrase or not) authenticates through the browser while password login and host-key verification keep working.

- Key formats: OpenSSH and legacy PEM encodings of Ed25519, ECDSA (P-256/384/521), RSA. DSA and unknown PEM types fail as unsupported. Assumption: legacy PEM RSA/EC is acceptable because x/crypto parses it and it is the same key algorithm.
- A passphrase given for an unencrypted key is ignored, not an error.
- "Key rejected by server" has no copy-deck string; proposed copy below for the lead/UX writer to approve.

## 2. Spec coverage

| Requirement | Files | Test | State |
|---|---|---|---|
| Parse key, specific errors (invalid, unsupported, passphrase) | engine/sshclient/key.go | key_test.go TestParsePrivateKey* | done |
| Key auth with host-key check | engine/sshclient/client.go (ConnectWithKey) | TestConnectWithKey* | done |
| Server rejection typed (ErrKeyRejected) | engine/sshclient/client.go | TestConnectWithKeyReportsRejectedKey | done |
| Password login unchanged | engine/sshclient/client.go | existing suite + TestPasswordLoginUnaffectedByAuthorizedKey | done |
| Test server accepts test public key | engine/sshclient/testserver.go (AuthorizeKey), engine/cmd/testsshd/main.go (optional 3rd arg: authorized_keys file) | Go tests use AuthorizeKey; testsshd arg not yet exercised | done, testsshd path unverified |
| WASM bridge accepts key | engine/main.go | none | NOT DONE |
| Connect form method choice, file picker, paste, passphrase | frontend/src/components/ConnectDialog.tsx | none | NOT DONE |
| Typed error mapping | frontend/src/connectionErrors.ts | none | NOT DONE |
| Help content | frontend/src/helpTopics.ts | none | NOT DONE |
| e2e key login | frontend/e2e, frontend/playwright/global-setup.ts | none | NOT DONE |
| README / engine README | README.md, engine/README.md | n/a | NOT DONE |

Logical change IDs for the lead:
- K1-E1 (engine key auth): engine/sshclient/key.go (new), engine/sshclient/key_test.go (new), engine/sshclient/client.go, engine/sshclient/testserver.go, engine/cmd/testsshd/main.go.

## 3. Design decisions

- `sshclient.ParsePrivateKey(pem, passphrase []byte) (ssh.Signer, error)` wraps x/crypto `ssh.ParsePrivateKey` / `ParsePrivateKeyWithPassphrase` (x/crypto v0.58.0 keys.go:1345-1458 read locally) and classifies errors into sentinels `ErrKeyInvalid`, `ErrKeyUnsupported`, `ErrKeyPassphrase`. HIGH: covered per type and per error.
- Allowlist by `signer.PublicKey().Type()` refuses DSA, which x/crypto still parses. HIGH.
- `Connect` keeps its signature; both it and new `ConnectWithKey` call a private `connect(..., ssh.AuthMethod, ...)`. Reuse of the existing cancel/handshake path, no duplication. HIGH.
- `ConnectWithKey` wraps "unable to authenticate" as `ErrKeyRejected` ("private key rejected by server"). x/crypto exposes no typed auth error, so text match is the only seam. MED.
- Test server: `AuthorizeKey(pub)` plus `PublicKeyCallback`; password callback unchanged.

## 4. Verification evidence

- `go test ./...` (engine): `Go test: 78 passed in 4 packages`
- `GOOS=js GOARCH=wasm go vet ./...`: no output, exit 0.
- Not run: ./build.sh, frontend and relay npm suites, Playwright (no frontend change yet).

## 5. Remaining plan (for the next builder)

1. engine/main.go: accept arg 4 as `{ privateKey: Uint8Array, passphrase: string }` beside string and `{ fromVault }`. Copy bytes with js.CopyBytesToGo, parse in the connect goroutine before `wsconn.Dial` (bad key never reaches the relay), then `clear()` the Go key and passphrase byte slices. Signer internals cannot be zeroed from outside x/crypto; note as residual. Call `sshclient.ConnectWithKey`.
2. frontend/src/ssh/engine.ts: add `{ kind: "key"; privateKey: Uint8Array; passphrase: string }` to `ConnectPassword`; window.sshConnect type; `privateKey.fill(0)` after success or non-host-key failure. Keep the buffer on HostKeyRejectedError because App retries `status.pending` after Trust and connect.
3. ConnectDialog: radio "Authentication method" (Password / Private key); file input "Private-key file" (required when paste box empty), paste textarea (new string, needs approval, proposed "Or paste the private key"), "Key passphrase" (optional), hint from deck; read the File at submit (fresh Uint8Array per attempt); "Reading private key..." on the button while reading. Never write key or passphrase to storage or SavedHosts.
4. connectionErrors.ts kinds, checked before `unable to authenticate`: `private key rejected by server` -> message "The server did not accept this private key." recovery "Check the username and that the server lists the matching public key in authorized_keys, then try again." (proposed, not in deck); `private key format not supported` -> deck unsupported string with "Supported formats: OpenSSH or PEM Ed25519, ECDSA, and RSA keys."; `key passphrase did not unlock` -> deck wrong-passphrase string; `private key could not be read` -> deck invalid-key string.
5. helpTopics.ts: connect topic paragraph on key login; troubleshooting paragraph for key errors; privacy line that the key is held for this connection only.
6. e2e: fixture keys via ssh-keygen in frontend/e2e/fixtures (unencrypted + passphrase), authorized_keys passed as testsshd 3rd arg in global-setup.ts; spec for key login, wrong passphrase, rejected key.
7. README and engine/README.md: document key login and the testsshd argument.

## 6. Not verified

- testsshd authorized_keys argument: compiles, not run.
- Everything in section 5.

## Adjacent notes

- `crypto/dsa` is deprecated in Go; key_test.go uses it only to build an unsupported-key fixture. Staticcheck may flag it. LOW.
