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

## Session 2

### 1. Spec read and assumptions

Building: private-key login for users of key-only SSH hosts, done means a selected or pasted supported key authenticates in the browser while password login and host-key verification still work.

- Ambiguity: which formats? Used the committed engine parser's OpenSSH and PEM Ed25519, ECDSA, and RSA support, as approved in the handoff.
- Ambiguity: should keys persist? No, per K1 spec and lead decision. The form clears its file and pasted text after submit; the app retains key bytes only through a host-key prompt and clears them after connection, failure, or cancellation.
- Ambiguity: rejected-key copy? Used the lead-approved message and recovery text verbatim.

### 2. Spec coverage and logical changes

| Requirement | ID and files changed | Test |
| --- | --- | --- |
| WASM key login and host-key verification | K1-B1: `engine/main.go`, `frontend/src/ssh/engine.ts` | `frontend/src/ssh/engine.test.ts`; `frontend/e2e/connect-flow.spec.ts` |
| File, paste, passphrase, empty input, loading state | K1-U1: `frontend/src/components/ConnectDialog.tsx`, `frontend/src/app.css` | `frontend/src/components/ConnectDialog.test.tsx`; browser key login and 320px layout |
| Key bytes retained for trust retry, cleared on completion or cancellation | K1-U2: `frontend/src/ssh/engine.ts`, `frontend/src/App.tsx` | `frontend/src/ssh/engine.test.ts`, `frontend/src/App.test.tsx`; browser host-key retry |
| Specific invalid, unsupported, passphrase, and rejection messages with Help links | K1-U3: `frontend/src/connectionErrors.ts`, `frontend/src/helpTopics.ts` | `frontend/src/connectionErrors.test.ts`; browser wrong-passphrase and rejected-key tests |
| Real relay and testsshd key login | K1-T1: `frontend/playwright/global-setup.ts`, `frontend/e2e/connect-flow.spec.ts` | Playwright suite, 20 passed |
| User and engine documentation | K1-D1: `README.md`, `engine/README.md` | Reviewed against implemented behavior |
| Report | K1-R1: this Session 2 section | `git diff --check` |

K1-E1 remains commit `5846632` at HEAD. No Session 2 commit was made, as instructed. Password and saved-password paths retain their six-argument WASM interface. No relay, vault, or stored-data format changed.

### 3. Design decisions

- `resolveAuth` | modified `engine/main.go:61` | accepts existing password forms or a key object | reuses the six-argument entry point. Confidence HIGH, Go vet and browser key login passed.
- `connect` | modified `engine/main.go:118` | parses before relay dial and calls committed `ConnectWithKey` | reuses host-key verification and session setup. Confidence HIGH, browser trust and key login passed.
- `ConnectDialog` | modified `frontend/src/components/ConnectDialog.tsx:52` | chooses auth method, reads file at submit, accepts paste and passphrase | follows the existing connect form. Confidence HIGH, unit and browser tests passed.
- `connectSession` and `App` | modified `frontend/src/ssh/engine.ts:116`, `frontend/src/App.tsx:153` | retain key bytes through trust prompt and clear them afterward | follows the existing retry path. Confidence HIGH, unit and browser tests passed.
- `describeConnectionFailure` and Help | modified `frontend/src/connectionErrors.ts:20`, `frontend/src/helpTopics.ts:26` | map typed key errors to recovery copy and Help | reuses the existing Help link. Confidence HIGH, mapping tests passed.
- E2E keys | modified `frontend/playwright/global-setup.ts:109` | generates temporary Ed25519 keys and authorizes one | avoids checked-in private keys. Confidence HIGH, browser suite passed.
- Browser file reading uses `Blob.arrayBuffer()`, which `File` inherits, and Go validates `Uint8Array` before `CopyBytesToGo`. [MDN Blob API](https://developer.mozilla.org/en-US/docs/Web/API/Blob), accessed 2026-11-01, scope: browser Blob/File API; [Go syscall/js](https://pkg.go.dev/syscall/js), accessed 2026-11-01, scope: Go 1.27.3 project's `CopyBytesToGo` API.

Data flow: selected file or pasted text -> `Uint8Array` -> WASM copy -> Go signer -> encrypted SSH stream through relay. Data flow: key parser or server rejection -> typed error text -> connection error variant -> Help link. Data flow: host-key rejection -> pending key bytes -> trust retry or cancellation -> zeroed byte array.

Out of scope: FIDO2, agent forwarding, cloud sync, automatic remote key installation, key vault storage, and relay protocol changes.

### 4. Self-review

- K1-SR1 | LOW | `engine/main.go:123` | x/crypto retains signer internals after temporary Go input slices are cleared | No safe wipe API exists in the pinned dependency; documented as residual below.
- K1-SR2 | LOW | `engine/sshclient/key_test.go:4` | deprecated `crypto/dsa` constructs the unsupported-algorithm fixture | Left unchanged: a fabricated unknown PEM type tests parser rejection but does not exercise the DSA allowlist.
- K1-SR3 | LOW | `frontend/src/app.css:1914` | new auth choice moved the connect action below a 320px viewport | Reduced narrow-screen spacing; the 320px browser check passes.
- No debug output, dead code, new dependency, or unrelated file changes found.

### 5. Verification evidence

- Engine `go test ./...`: `Go test: 78 passed in 4 packages`
- Engine `GOOS=js GOARCH=wasm go vet ./...`: exit 0, no output.
- Engine `./build.sh`: `built dist/engine.wasm, dist/wasm_exec.js, dist/testsshd`
- Frontend `npm ci`: `added 124 packages, and audited 125 packages in 2s`; `found 0 vulnerabilities`.
- Frontend `npm test -- --reporter=dot`: `Test Files  29 passed (29)`; `Tests  295 passed (295)`.
- Frontend `npx tsc -b`: `TypeScript: No errors found`.
- Frontend `npm run lint`: `> oxlint` (exit 0).
- Frontend `npm run format:check`: `All matched files use the correct format.`
- Frontend `npm run build`: `✓ built in 186ms` (exit 0).
- Browser `npm run test:e2e -- --reporter=dot`: `20 passed (9.1s)`. The key-login test used the real relay and testsshd, accepted a host key, and asserted terminal echo of `key-login`. The error-path test observed wrong-passphrase and server-rejection copy.
- Relay `npm ci`: `added 49 packages, and audited 50 packages in 1s`; `found 0 vulnerabilities`.
- Relay `npm test`: `Test Files  4 passed (4)`; `Tests  47 passed (47)`.
- Relay `npm run lint`: `> oxlint src scripts test` (exit 0).
- Relay `npm run build`: `> tsc -p tsconfig.build.json` (exit 0).
- Relay `npm run format:check`: `src/local-relay.test.ts (2ms)`; `Format issues found in above 1 files. Run without --check to fix.` This file was untouched in Session 2.
- `git diff --check`: exit 0, no output.

### 6. Notes for the lead and unverified items

- The Go signer and immutable JavaScript passphrase string cannot be zeroed through the available APIs. Temporary Go input slices and JavaScript key byte arrays are cleared. Neither value is stored or logged by this change.
- Relay formatting failure is adjacent and untouched. Fix `relay/src/local-relay.test.ts` separately if the lead wants a clean repository-wide format gate.
- SUSPECTED: the Vite bundle warning may merit a later size review; production build and browser tests passed.
- Docker buildx image builds were not run because sandbox Docker state may be read-only, per session instructions.
- Physical mobile devices, non-Ed25519 browser key files, and external SSH servers were not tested. The committed Go parser tests cover ECDSA, RSA, PEM, encrypted keys, and error classes.

## Fix K1-1

Encrypted PKCS#8 PEM (`ENCRYPTED PRIVATE KEY`) now returns `ErrKeyUnsupported` before passphrase parsing. The frontend offers `ssh-keygen -p -f <keyfile>` to convert the key to OpenSSH format. The pinned parser accepts OpenSSH Ed25519, ECDSA, and RSA keys with or without passphrases; unencrypted PKCS#8 PEM; and legacy RSA or EC PEM with or without passphrases. Product copy now names those formats. A test-only encrypted PKCS#8 Ed25519 fixture checks the unsupported error with correct, wrong, and absent passphrases. The OpenSSH `ssh-keygen` manual documents `-p` format conversion and OpenSSH output by default; conversion was also verified against the fixture.
