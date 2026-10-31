# localssh design system

## System

localssh is an operating interface for opening and using SSH sessions. The terminal is the primary surface. The connection form, saved-host vault, session toolbar, and touch key bar support that task.

## Tokens

- UI text uses IBM Plex Sans. Terminal chrome uses IBM Plex Mono; the terminal defaults to the system monospace font and offers bundled alternatives.
- The UI follows `prefers-color-scheme` with light and dark token sets in `frontend/src/app.css`. The terminal theme is chosen separately in Appearance and persists per browser.
- Canvas, surface, text, border, danger, and focus tokens live in `frontend/src/app.css`. The indigo-grey accent is `#5f688a` in light mode and `#98a2c7` in dark mode. The default terminal bezel uses Tokyo Night colors.
- Controls use an 8 to 9px radius, cards and dialogs use 12px, and the brand mark uses 9px. The terminal has square edges on narrow screens to preserve space.
- Toolbar icons use vendored Material Symbols outlined paths in `frontend/src/components/Icon.tsx`. Text glyphs represent terminal keys.

## Layout

- Connection details precede optional saved hosts in the visual and keyboard order. The connect page uses document scrolling when needed.
- An active session fills the visual viewport. The terminal owns vertical scrollback; the touch key bar scrolls horizontally.
- The toolbar shows the connection state and target. On a narrow screen, the session identity gets its own row.

## Components

- Buttons, summaries, inputs, and selects have at least 44px height. Focus uses a 3px outline. The clipboard menu includes a read-only field when automatic copy fails.
- The saved-host vault is local to the browser and separate from the connection form. Host-key verification uses a dialog before first connection or a changed key.
- The touch key bar provides missing shell keys and sticky modifiers. Long press and drag selects terminal text; the Clipboard menu handles copy and paste.

## Rules

- Preserve the existing indigo-grey accent, logo, control labels, form field names, and security language unless product requirements change.
- Keep status and errors in text as well as color. Honor reduced motion. Retain a manual paste path because non-localhost HTTP LAN pages lack the Async Clipboard API.
- Keep the relay outside the credential boundary. The browser hosts the Go WASM SSH engine; the relay transports encrypted SSH bytes.

## Open items

- Verify selection, keyboard movement, and clipboard callouts on physical iPhone and iPad Safari. Chromium touch emulation does not reproduce native selection handles or WebKit keyboard behavior.
- A later step owns in-app help. Useful entry points are the toolbar and the connection, vault, and clipboard failure states.
- The clipboard icon and keyboard-dismiss cue use local SVG markup outside the Material Symbols map. Consolidate only if an official matching glyph exists.
