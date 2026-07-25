# localssh relay

Bridges the browser's WebSocket to a raw TCP connection, because browsers
cannot open TCP sockets. It pumps bytes and nothing more: the SSH session is
negotiated end to end between the browser and the target, so the relay only
ever sees ciphertext.

The relay runs on Node and `ws`. The Docker entry point applies the access
policy in `src/access.ts`; the loopback development command omits that policy
so local development needs no configuration.

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
| `ALLOWED_HOSTS`   | yes      | Comma-separated hostnames the relay may dial. `*.example.com` matches subdomains, but not the bare domain. |
| `ALLOWED_PORTS`   | no       | Comma-separated ports. Defaults to `22`.                           |

A rejected upgrade returns `403`. A target rejected after the connect frame
closes the socket with code `1008`.

## Flow control

When the target stops accepting client data, the relay pauses its WebSocket
until the target drains. In the reverse direction, it pauses the target once
more than 1 MiB is buffered for the browser and resumes below 256 KiB.

## Development

```bash
npm ci
npm run relay:local        # binds 127.0.0.1:8787
npm run relay:local 9000   # or another port
npm test
npm run build
```

The local relay binds loopback and applies no allowlist, so it stays usable
for development without becoming a proxy for your network. Do not expose it.
