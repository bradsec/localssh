# localssh relay

Bridges the browser's WebSocket to a raw TCP connection, because browsers
cannot open TCP sockets. It pumps bytes and nothing more: the SSH session is
negotiated end to end between the browser and the target, so the relay only
ever sees ciphertext.

The relay runs on Node 26 and `ws`. The standalone Docker entry point applies
the access policy in `src/access.ts`; the loopback development command omits
that policy so local development needs no configuration. The combined image
serves the page and `/relay` on one port and checks the page origin by default.

## Protocol

The client sends one JSON text frame, then raw SSH bytes as binary frames:

```json
{ "host": "ssh.example.com", "port": 22 }
```

The relay closes the socket if that frame does not arrive within 10 seconds,
fails validation, or names a target outside the allowlist.

## Configuration

**The Docker relay denies every request until it is configured.** Without
allowlists it would be an open TCP proxy: anyone who found the URL could reach
any host and port through it.

| Variable          | Required | Meaning                                                           |
| ----------------- | -------- | ----------------------------------------------------------------- |
| `ALLOWED_ORIGINS` | yes      | Comma-separated origins allowed to open a session. `*` allows any. |
| `ALLOWED_HOSTS`   | yes      | Comma-separated target names or IPs. `*.example.com` matches subdomains, but not the bare domain. Hostname rules trust DNS for those names. |
| `ALLOWED_PORTS`   | no       | Comma-separated ports. Defaults to `22`.                           |
| `MAX_SESSIONS` | no | Maximum concurrent sessions. Defaults to `256`. |
| `TARGET_CONNECT_TIMEOUT_MS` | no | Target TCP connection deadline in milliseconds. Defaults to `10000`. |

These requirements apply to the standalone relay. The combined image defaults
`ALLOWED_HOSTS` to `*` and checks same-origin requests unless
`ALLOWED_ORIGINS` is set. Restrict `ALLOWED_HOSTS` before exposing the service
to other devices. Prefer IPs or names under owner-controlled DNS, plus outbound
rules limiting the host to intended SSH targets. The combined image also accepts
`TLS_CERT_FILE` and `TLS_KEY_FILE` together for HTTPS and WSS, `PORT` (default
`80`), `HOST` (default `0.0.0.0`), and `STATIC_ROOT` (default `/app/frontend`,
for development or tests). See [deployment](../README.md#install-with-docker).

A rejected upgrade returns `403`. A target rejected after the connect frame
closes the socket with code `1008` and the reason `target not allowed`; the
relay log names the rejected host and port. A target that cannot be dialled
closes the socket with code `1011` and one of these reasons, which the app turns
into a recovery step: `target host not found`, `target connection refused`,
`target connection timeout`, `target host unreachable`, or
`target connection error`.

## Flow control

When the target stops accepting client data, the relay pauses its WebSocket
until the target drains. In the reverse direction, it pauses the target once
more than 1 MiB is buffered for the browser and resumes below 256 KiB.

## Development

Use Node 26 from [`.nvmrc`](../.nvmrc). From this directory:
With nvm, run `source ~/.nvm/nvm.sh && nvm use 26` before npm commands.

```bash
npm ci
npm run relay:local        # binds 127.0.0.1:8787
npm run relay:local 9000   # or another port
npm test
npm run build
```

The local relay binds loopback and applies no allowlist, so it stays usable
for development without becoming a proxy for your network. Do not expose it.
