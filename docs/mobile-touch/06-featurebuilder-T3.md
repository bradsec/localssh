# T3: Versioned relay frame contract

Building: v2 relay frame codecs for resumable SSH transport; done means every specified frame round-trips, malformed frames fail, and v1 bytes remain unchanged.

## Built

- `relay/src/protocol.ts`: added `V2Frame`, `encodeV2Frame`, and `decodeV2Frame`. V2 uses fixed-length JSON arrays beginning with `2`; binary payload is canonical base64. Fixed tuple length rejects duplicate or conflicting fields.
- `relay/src/protocol.ts`: validates every frame variant, direction, nonnegative safe-integer offsets, offset plus payload length, 32-character lowercase hex session IDs, 64-character lowercase hex bearer tokens, canonical base64, 4,096-character control frames, and 256-KiB data payloads. `ready` carries expiry, per-direction unacknowledged-byte cap, and grace period.
- `relay/src/protocol.test.ts`: added v2 wire fixtures, round trips for all eight frame types, malformed-frame cases, bounds, and byte-for-byte v1 encoding proof.

## Design

- `protocol.ts` | modified | one v2 union and two codecs | reuses existing v1 host and port validation without changing v1.
- Client input: `connect` -> `[2,"connect",host,port]`; relay response: `ready` -> session ID, token, expiry, cap, grace.
- Reattach: `resume` -> session ID, token, both ACK offsets; `resumed` -> both relay ACK offsets.
- Stream: `data` -> direction, starting offset, opaque bytes; `ack` -> direction, next accepted offset.
- Lifecycle: `detach` or `error` -> transport state change; error codes are an allowlist.
- Confidence HIGH: tests fix the wire shape and validation at the exported codecs. Cross-frame replay correctness remains T7's stateful responsibility.

## Verification

Test-first red run: `rtk npm test -- src/protocol.test.ts` exited 1, `Tests  11 failed | 28 passed (39)`, with `TypeError: encodeV2Frame is not a function`.

Final commands from `relay/`:

```text
rtk npm test -- src/protocol.test.ts
Test Files  1 passed (1)
     Tests  39 passed (39)

rtk npm test
Test Files  5 passed (5)
     Tests  92 passed (92)

rtk npm run build
> tsc -p tsconfig.build.json

rtk npm run lint
> oxlint src scripts test

rtk npm run format:check
All matched files use the correct format.
```

Each final command exited 0. `rtk git diff --check` exited 0 before the final test-only edit; final formatting completed afterward.

## Unverified and notes for the lead

- No v2 relay or WASM runtime exists yet, so an end-to-end v2 connection cannot run in T3. T6-T8 own that integration.
- Codec validation is per frame. T7 must reject gaps, conflicting retransmissions, and ACKs inconsistent with retained ranges.
- T6 should generate 16 random bytes as the lowercase hex session ID and 32 random bytes as the lowercase hex token. Use the v2 tuple shape and `ready` fields in this report.
- Existing v1 behavior and relay access policy remain unchanged. Documentation rollout belongs to T11.
- No branch or commit was created. Other builders' files were left untouched.
