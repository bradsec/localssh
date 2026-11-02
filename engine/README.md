# localssh engine

The SSH client, written in Go and compiled to WebAssembly. It runs in the
browser tab, which is what keeps credentials and host-key decisions on the
user's device rather than on a server.

| Package     | Role                                                                  |
| ----------- | --------------------------------------------------------------------- |
| `main`      | Exposes `sshConnect` on `window` and bridges terminal and SFTP callbacks to JavaScript. |
| `sshclient` | Handshake, password or key auth, host-key verification, PTY, and a test server with SFTP. |
| `remotefiles` | SFTP listing, staged upload, and bounded download. |
| `wsconn`    | A `net.Conn` over a browser WebSocket, so `sshclient` dials as if TCP.  |

`sshclient` takes an already-established `net.Conn`, so the same code runs
against real TCP in tests and against the relay in the browser.

## Build

```bash
./build.sh
```

Produces `dist/engine.wasm`, `dist/wasm_exec.js` (copied from `GOROOT`), and
`dist/testsshd`. `frontend/scripts/copy-engine.mjs` copies the first two into
`frontend/public/` on `predev` and `prebuild`, so they are build output and
are not committed.

`dist/testsshd` is a real SSH server used by the browser end-to-end test. It
echoes bytes rather than running a shell. Run it as
`testsshd <username> <password> [authorized_keys file]` to allow test keys.

## JavaScript interface

```js
const handle = await sshConnect(relayWsUrl, host, port, username, password, {
  onHostKey: (fingerprint) => boolean,  // must return synchronously
  onData: (chunk) => void,              // Uint8Array
  onClose: (reason) => void,            // empty after a clean exit
});

handle.write(new Uint8Array([65]));
handle.resize(cols, rows);
const files = await handle.openFiles();
const listing = await files.list(".");
// listing: { path, entries: [{ name, kind, isLink, size }], truncated }
files.cancel();
files.close();
handle.close();
```

The fifth argument also accepts `{ fromVault: entryId }` or
`{ privateKey: Uint8Array, passphrase: string }`. The engine copies key bytes,
parses them before dialing the relay, and clears the temporary Go byte slices.
Supported private keys are OpenSSH Ed25519, ECDSA, or RSA (with or without a
passphrase), unencrypted PKCS#8 PEM, and legacy RSA or EC PEM (with or without a
passphrase). Encrypted PKCS#8 PEM is unsupported.

`onHostKey` receives the SHA-256 fingerprint in OpenSSH's `SHA256:...` form
and must answer synchronously, so callers load their trusted fingerprints
before connecting. Returning false aborts the connection.

Connecting is bounded by a 30 second deadline covering the relay dial, the
handshake, and authentication.

`openFiles()` opens SFTP on the existing verified SSH session. The file handle
also exposes `upload(path, file, overwrite, onProgress)` and
`download(path, onChunk, onProgress, opts?)`. `opts` is
`{ offset, expectSize, expectMtime, tail, onStart }`: above offset 0 the
download resumes there only when the remote size and mtime (Unix ms) match and
the remote bytes before `offset` equal `tail`, otherwise it rejects with
`remote file changed`. `onStart({ size, mtime })` runs before the first chunk.
Uploads stage in a hidden remote file;
`close()` on the file handle leaves the terminal open. Closing the SSH handle
closes both. The frontend [user guide](../docs/USER-GUIDE.md) describes the
visible file behavior.

## Test

```bash
go test ./...                      # against a real in-process SSH server
GOOS=js GOARCH=wasm go vet ./...   # the browser build is behind js/wasm tags
```

The `js && wasm` build tags on `main` and `wsconn` mean a plain `go build` or
editor language server will not type-check them. Use the `GOOS`/`GOARCH` form
above.
