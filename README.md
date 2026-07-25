# localssh

An SSH client that runs in the browser. The SSH implementation is compiled to
WebAssembly and runs in the page, so the handshake, password authentication,
and host-key verification all happen on your device. The relay in between moves
encrypted bytes and cannot read the session.

The relay exists because browsers cannot open raw TCP sockets. It is a dumb
pipe: it never sees your password, and a malicious relay cannot impersonate a
server without failing the host-key check performed in the browser.

If you find this useful, please consider starring the repository. It helps
others discover the project.

## Interface preview

![localssh connection form with host, port, username, and password fields](screenshot1.png)

![localssh connected terminal displaying a remote directory listing](screenshot2.png)

## Repository layout

| Path       | What it is                                                       |
| ---------- | ---------------------------------------------------------------- |
| `engine/`  | Go SSH engine compiled to WebAssembly, plus a test SSH server     |
| `relay/`   | Node WebSocket-to-TCP relay                                      |
| `frontend/`| React and Vite UI with the xterm.js terminal                      |

## Install with Docker

Docker Compose pulls and starts the published frontend and relay images. Install
Docker Engine with the Compose plugin, or Docker Desktop. No local Go or Node
installation is required.

```bash
git clone https://github.com/bradsec/localssh.git
cd localssh
docker compose up -d
```

Open <http://localhost:9080>.

### Stop or remove the Docker installation

Stop and remove the application containers and network:

```bash
docker compose down
```

To also remove the downloaded frontend and relay images:

```bash
docker compose down --rmi all --remove-orphans
```

These commands do not remove the source checkout or `.env` configuration.

Both published ports bind to `127.0.0.1`, so other machines cannot reach the
frontend or use the relay. The default relay policy permits any hostname on
port 22, but only the local frontend origins may open a relay connection.

### Configuration

Copy the example before changing ports or tightening the target allowlist:

```bash
cp .env.example .env
```

| Variable | Default | Meaning |
| -------- | ------- | ------- |
| `FRONTEND_PORT` | `9080` | Host port for the web interface. |
| `RELAY_PORT` | `8787` | Host port for the WebSocket relay. |
| `VITE_RELAY_WS_URL` | `ws://127.0.0.1:8787` | Relay URL compiled into the frontend. |
| `ALLOWED_ORIGINS` | local frontend URLs | Exact browser origins allowed to connect. |
| `ALLOWED_HOSTS` | `*` | Comma-separated target hosts. `*.example.com` matches subdomains. |
| `ALLOWED_PORTS` | `22` | Comma-separated target TCP ports. |

`LOCALSSH_VERSION` selects the container image tag. Leave it unset to track the
latest release, or set it to a release such as `2026.07.25` for repeatable
installs.

If `FRONTEND_PORT` changes, update `ALLOWED_ORIGINS` to match. Changing only
`FRONTEND_PORT` does not require an image rebuild. If `RELAY_PORT` changes,
update `VITE_RELAY_WS_URL` and rebuild the frontend because the relay URL is
compiled into it. For a private set of targets, replace `*` with explicit
names:

```dotenv
ALLOWED_HOSTS=server.example.com,*.internal.example
```

### Changing ports

Edit `.env` and keep the frontend origin and relay URL synchronized with the
published ports. For example, to use frontend port `9180` and relay port
`9878`:

```dotenv
FRONTEND_PORT=9180
RELAY_PORT=9878
VITE_RELAY_WS_URL=ws://127.0.0.1:9878
ALLOWED_ORIGINS=http://localhost:9180,http://127.0.0.1:9180
```

Rebuild and restart after changing these values:

```bash
docker compose up --build -d
```

Then open <http://localhost:9180>. `VITE_RELAY_WS_URL` is compiled into the
frontend image, so `docker compose restart` alone does not apply a relay URL
change. If Docker reports that a port is already allocated, choose an unused
`FRONTEND_PORT` or `RELAY_PORT` and update the related values above.

Do not change the Compose port bindings from `127.0.0.1` to `0.0.0.0` without
also providing HTTPS, authentication, and a restrictive relay policy. An
internet-accessible relay can be abused as an SSH proxy.

## Versioning

localssh uses calendar versions in `YYYY.MM.DD` format. The current release is
`2026.07.25`.

The canonical version is stored in `VERSION` and passed to both container
images as OCI metadata. The private npm packages use the SemVer-compatible
equivalent (`2026.7.25`) because SemVer forbids leading zeroes in numeric
fields.

Changing `VERSION` on `main` runs the release workflow. The workflow validates
the calendar date, runs the engine, relay, and frontend checks, publishes
multi-platform frontend and relay images to GitHub Container Registry, and
creates a matching `vYYYY.MM.DD` GitHub release. Each calendar version can be
released only once.

## Security model

What this design does and does not protect you from:

- **The relay cannot read your session.** SSH is negotiated end to end between
  the browser and the target, so the relay only ever sees ciphertext.
- **Host keys are verified in the browser.** On first connection you are shown
  the SHA-256 fingerprint and must accept it. Accepted keys are stored in
  IndexedDB, and a later change is reported as a warning you must confirm.
- **Passwords stay in memory.** They live in React state for the life of the
  connection and are never written to storage or sent to any origin server.
- **The optional "Remember this host" setting stores the host and port only.**
  Usernames and passwords are never persisted.
- **Anyone who can reach your relay can dial the hosts you allowlisted.** The
  relay does not authenticate users. Keep `ALLOWED_HOSTS` tight, and put the
  relay behind access control if it faces the internet.
- **This has not been independently audited.** Treat it accordingly.

## Terminal

Font, font size, and colour scheme are configurable from the Appearance menu
and persist in `localStorage`. The terminal reports its fitted size to the
remote PTY, so resizing the window, rotating a phone, or opening an on-screen
keyboard keeps width-aware commands formatting correctly.

Touch gestures, for devices with no physical Tab or arrow keys:

| Gesture            | Action           |
| ------------------ | ---------------- |
| Swipe right        | Tab              |
| Swipe left         | Esc              |
| Flick up or down   | Command history  |
| Pinch              | Font size        |

Vertical flicks defer to scrollback: while you are reading history, vertical
drags scroll normally.

## Development

Development from source requires Go 1.26 or newer and Node.js 22 or newer.

```bash
# Engine
cd engine && go test ./... && GOOS=js GOARCH=wasm go vet ./...

# Relay
cd relay && npm test

# Frontend
cd frontend && npm test && npm run lint && npx tsc -b && npm run build

# Browser end-to-end test (builds the engine, starts a test sshd and relay)
cd frontend && npm run test:e2e
```

## Credits and acknowledgements

### Libraries

| Project | Used for | Licence |
| ------- | -------- | ------- |
| [xterm.js](https://github.com/xtermjs/xterm.js) (`@xterm/xterm`, `@xterm/addon-fit`) | Terminal emulator and sizing | MIT |
| [golang.org/x/crypto](https://pkg.go.dev/golang.org/x/crypto/ssh) | Go SSH client implementation | BSD-3-Clause |
| [Go](https://go.dev) and its `syscall/js` WebAssembly support | The engine and its browser bridge | BSD-3-Clause |
| [React](https://react.dev) | UI | MIT |
| [Vite](https://vite.dev) | Build tooling and dev server | MIT |
| [TypeScript](https://www.typescriptlang.org) | Type checking | Apache-2.0 |
| [Vitest](https://vitest.dev) | Unit tests | MIT |
| [Playwright](https://playwright.dev) | Browser end-to-end tests | Apache-2.0 |
| [Testing Library](https://testing-library.com) | Component test helpers | MIT |
| [oxlint](https://oxc.rs) | Linting | MIT |
| [idb](https://github.com/jakearchibald/idb) | IndexedDB wrapper for known hosts | ISC |
| [ws](https://github.com/websockets/ws) | WebSocket server for the local dev relay | MIT |

### Fonts

All bundled through [Fontsource](https://fontsource.org).

| Font | Designer | Licence |
| ---- | -------- | ------- |
| [Fira Code](https://github.com/tonsky/FiraCode) (default terminal font) | Nikita Prokopov, from Fira Mono by Erik Spiekermann and Carrois Apostrophe | SIL OFL 1.1 |
| [JetBrains Mono](https://www.jetbrains.com/lp/mono/) | JetBrains | SIL OFL 1.1 |
| [Cascadia Code](https://github.com/microsoft/cascadia-code) | Microsoft | SIL OFL 1.1 |
| [IBM Plex Mono and IBM Plex Sans](https://github.com/IBM/plex) | Mike Abbink and Bold Monday for IBM | SIL OFL 1.1 |
| [Source Code Pro](https://github.com/adobe-fonts/source-code-pro) | Paul D. Hunt for Adobe | SIL OFL 1.1 |

### Colour schemes

Terminal palettes reproduce the published colours of their upstream projects:
[Solarized](https://ethanschoonover.com/solarized/) (Ethan Schoonover, MIT),
[Dracula](https://draculatheme.com) (Zeno Rocha, MIT),
[Nord](https://www.nordtheme.com) (Arctic Ice Studio, MIT),
[Gruvbox](https://github.com/morhetz/gruvbox) (Pavel Pertsev, MIT),
[One Dark](https://github.com/atom/atom) (Atom, MIT),
[Monokai](https://monokai.pro) (Wimer Hazenberg),
[Catppuccin](https://github.com/catppuccin/catppuccin) (MIT), and
[Tokyo Night](https://github.com/enkia/tokyo-night-vscode-theme) (MIT).

The GitHub mark in the About panel is a trademark of GitHub, Inc., used to link
to the project's repository.

## Licence

[MIT](LICENSE)
