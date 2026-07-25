# localssh frontend

React and Vite frontend for localssh. It provides the SSH connection form,
trust-on-first-use host-key verification, an xterm.js terminal, and persistent
terminal appearance settings.

See the [root README](../README.md) for the architecture, security model, and
credits.

Passwords stay in React state for the current session and are never written to
browser storage. Known host keys use IndexedDB. Font size, font family, and
terminal color scheme use `localStorage`. The optional "Remember this host"
switch is off by default and stores the host and port only.

The terminal automatically reports its fitted rows and columns to the remote
PTY. Resizing the browser, rotating a phone, opening an on-screen keyboard, or
changing the terminal font updates the remote session geometry so width-aware
commands format their output correctly.

Touch gestures: swipe right for Tab, swipe left for Esc, flick up or down for
command history, and pinch to change the font size. Vertical flicks defer to
xterm's scrollback while you are reading history.

## Development

Build the WASM engine before starting or building the frontend:

```bash
cd ../engine
./build.sh

cd ../frontend
npm ci
npm run dev
```

The frontend connects to `ws://127.0.0.1:8787` by default. Override the relay
URL with `VITE_RELAY_WS_URL`.

## Verification

```bash
npm test
npm run lint
npx tsc -b --pretty false
npm run build
```
