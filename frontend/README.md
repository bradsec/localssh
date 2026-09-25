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

Vault writes use IndexedDB to serialize changes across tabs while keeping the
existing encrypted blob in `localStorage`. A stale save locks the vault and
asks you to reload and unlock again; unsaved edits must be entered again.
Reload all open tabs after upgrading from a version without this protection.

The terminal automatically reports its fitted rows and columns to the remote
PTY. Resizing the browser, rotating a phone, opening an on-screen keyboard, or
changing the terminal font updates the remote session geometry so width-aware
commands format their output correctly.

If the engine rejects input, including when its 8 MiB input queue is full, an
alert reports that the input was not sent. The session remains connected.
Rejected input is not retried automatically; the alert stays until disconnect.

Touch gestures: swipe right for Tab, swipe left for Esc, flick up or down for
command history, and long-press then drag to select terminal text. Vertical
flicks defer to xterm's scrollback while you are reading history. Set the font
size from the Appearance menu.

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
