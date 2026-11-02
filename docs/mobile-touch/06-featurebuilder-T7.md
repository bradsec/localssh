# T7 feature builder report

Building: ordered v2 relay delivery for browser SSH users; done means TCP input reaches the target once and unacknowledged target output replays after reattach.

## Built

- `relay/src/local-relay.ts:227`: applies consumer ACKs to retained server bytes. Resume validates both offsets and replays from the consumer offset.
- `relay/src/local-relay.ts:242`: sends retained output in 32 KiB frames while bounding WebSocket buffered bytes. Send callbacks drive flushing, not consumer acknowledgement.
- `relay/src/local-relay.ts:410`: validates duplicate and overlapping client input against bounded byte history. Gaps, conflicting bytes, and missing history revoke the session with `offset_mismatch`.
- `relay/src/local-relay.ts:445`: acknowledges client input after the TCP write callback. The pending input queue remains capped at 256 KiB.
- V1 still uses its binary path. No protocol file, frontend file, dependency, or config changed for T7.

## Tests added

- `relay/src/local-relay.test.ts:21`: transport loss before server ACK replays exact output; consumer ACK prevents a second replay.
- `relay/src/local-relay.test.ts:88`: client replay reaches TCP once; conflicting duplicate closes the session.
- `relay/src/local-relay.test.ts:160`: matching partial overlap appends only new bytes; a gap closes one session while another remains usable.
- `relay/src/local-relay.test.ts:237`: simulated WebSocket pressure stops outbound sends, then flushing resumes.

## Checks

Red test run before implementation: `rtk npm test -- src/local-relay.test.ts` exited 1 with `Tests  2 failed | 45 passed (47)`.

Final commands from `relay/`:

```text
rtk npm test -- src/local-relay.test.ts
Test Files  1 passed (1)
     Tests  49 passed (49)

rtk npm test
Test Files  5 passed (5)
     Tests  104 passed (104)

rtk npm run build
> tsc -p tsconfig.build.json

rtk npm run lint
> oxlint src scripts test

rtk npm run format:check
All matched files use the correct format.
```

No commit or branch was made, per task instruction. Self-review found no remaining defect in the T7 write set. Confidence HIGH for tested relay ordering and replay, MED for browser transport integration pending T8.

## Unverified and notes for lead

- Browser WASM resume, SSH command execution, and physical iOS behavior await T8 and later tasks. These relay tests use real loopback WebSocket and TCP connections plus a controlled buffering seam.
- `ready.expiresAt` still describes the initial creation deadline. Detach renews the actual 120-second grace period; T8 should use `graceMs` after each detach, since v2 has no deadline-renewal frame.
- Concurrent frontend and protocol edits in the shared worktree were left untouched. No adjacent problem was fixed.
