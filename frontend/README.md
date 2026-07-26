# localssh frontend

React and Vite frontend for localssh. It provides the SSH connection form,
trust-on-first-use host-key verification, an xterm.js terminal, and persistent
terminal appearance settings.

See the [root README](../README.md) for the architecture, security model, and
credits.

Typed passwords stay in React state for the current connection. The optional
address book stores one encrypted vault in `localStorage`; saved passwords
remain inside the WebAssembly engine when used. Known host keys use IndexedDB,
and terminal appearance settings use `localStorage`. See the root README's
[Address book](../README.md#address-book) section for the full storage and
security model.

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
