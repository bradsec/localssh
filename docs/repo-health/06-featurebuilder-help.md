# H1 Help and recovery: blocked at spec conflict

## Spec read and assumptions

Building: in-app Help and typed connection recovery for LAN SSH users, done means Help opens from both screens and each specified failure has a recovery step and topic link.

No implementation assumption taken. U-09 requires an architecture decision before edits: should origin and session-limit checks move after WebSocket upgrade so the relay can send machine-readable close reasons, or should these failures remain a combined, uncertain diagnosis?

The worktree was clean on `review/2026-10-31` at entry. No branch or commit was made, as instructed.

## Blocking conflict

`relay/src/local-relay.ts:115-134` rejects a disallowed origin with HTTP 403 and a full session pool with HTTP 503 before the WebSocket upgrade. `engine/wsconn/wsconn.go:18-28,100-107,147-151` receives only a generic WebSocket error for either rejection. Thus the current engine cannot emit separate typed origin-refusal, session-limit, and relay-unreachable failures. Mapping the generic event to one of those types would present an unverified cause as fact. [MDN WebSocket error event](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/error_event) documents the generic `Event`; [MDN WebSocket server guidance](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_servers) notes that browsers may not display a rejected handshake response body. Both accessed 2026-11-01; scope: browser WebSocket API and server handshake behavior.

The instruction says to stop and report when step inputs conflict with the code. H1a and H1b were not started because U-09 is part of the same requested feature.

## Spec coverage

| Requirement | ID to files changed | Test |
| --- | --- | --- |
| H1a, full searchable and accessible Help on both screens | None | Not run |
| H1b / U-10, contextual topic links | None | Not run |
| H1c / U-09, typed connection failures | None | Not run; blocked by handshake conflict |
| Unit and end-to-end tests | None | Not run |

## Design decision pending

`Help` | `frontend/src/components/Help.tsx` | Existing nine-topic copy deck and toolbar entry | Reuse, not a parallel Help component. HIGH confidence: source inspected.

`Relay failure channel` | `relay/src/local-relay.ts`, `engine/wsconn/wsconn.go` | Convey origin and session-limit refusal to the browser | Decision pending. HIGH confidence: current pre-upgrade rejection and generic browser event verified in source and browser documentation.

Data flow today: WebSocket handshake rejection -> generic browser error -> same engine error for distinct causes. HIGH confidence: cited source paths.

Out of scope: K1, F1, T1 future features. No adjacent problem was changed or verified.

## Self-review and verification

No change needed in production files; no diff to review. No full suite, end-to-end path, edge path, lint, format, build, or Docker check was run because implementation stopped at the specified conflict. The only command result was `rtk git status --short --branch`: `## review/2026-10-31`.

## Input needed

Choose whether the relay may accept the WebSocket upgrade and then immediately close unauthorized origins and over-limit sessions with typed reasons, before reading a connect frame or opening TCP. This would preserve the dumb-pipe and no-credential-server constraints, but change the handshake rejection point. If the pre-upgrade 403/503 behavior must remain frozen, U-09 needs a narrower acceptance criterion for these two causes.
