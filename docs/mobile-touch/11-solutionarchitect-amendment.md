# Architecture amendment: user-chosen keep-alive, operator cap, transfer continuity

**Frame:** Amending the approved v2 resume design (`03`) so that a user-chosen keep-alive, bounded by an operator cap, preserves SSH sessions and in-flight SFTP transfers. The ranking stays: correctness and security first, bounded relay resources second, low operating cost third. The binding constraint: SSH state lives only in a page that iOS can suspend or evict.

Inputs: `03`, `05` (Decisions, T3 to T11), `06` T3/T6/T7/T9 reports, `06-featurebuilder-T8.md.prev`, `08` Q-01 to Q-03, `09` Q7. Code inspected 2026-11-02: `relay/src/protocol.ts`, `relay/src/local-relay.ts`, `engine/sftpjs.go`, `engine/remotefiles/remotefiles.go`, `frontend/src/components/FilePanel.tsx`, the uncommitted T8 diff, and `github.com/pkg/sftp` v1.13.12 `client.go`.

Fixed user decisions: the options are Off, 2 min (default), 5, 10, 15 min, 1 hour, and Until I disconnect. The operator cap comes from an env var, defaults to 1 hour, and can be set to unlimited. Effective grace = min(choice, cap).

## 1. What changes and what does not

- Unchanged: D1 (SSH stays in WASM, the relay sees only ciphertext), D3 (bytes are sequenced and acknowledged both ways), byte caps per direction, v1 compatibility, and expiry on page eviction (F2).
- Changed: D2 (the fixed 120 s grace becomes a per-session granted grace). D4 gains token rotation, takeover and explicit revoke. F4 gains capacity eviction and full byte accounting. The "transfer fails visibly" line in `03` §Byte continuity and in T9 becomes "the transfer continues within grace and resumes by offset after expiry".
- v2 has not shipped: every v2 change is uncommitted (`git status`). Amend the v2 tuples in place. No v3 is needed.

## 2. Decision records

ID | Decision | Why | Rejected and why | Rules out / revisit if
--- | --- | --- | --- | ---
A1, one-way | **Off = the v1 path exactly.** No v2 connect, no token, no relay retention. `pagehide` closes, as it does today. | No token exposure, no relay resources, an already-tested path, one less state. What the user sees matches `08` K-07. HIGH. | v2 with zero grace: it issues a token and allocates state that can never be used, and any socket blip kills the session anyway. | Off gives no recovery from a brief network blip. Revisit if users want blip recovery without background hold.
A2, one-way contract | v2 `connect` carries `requestedGraceMs`: a positive integer, or `null` for Until I disconnect. The relay grants `min(requested, cap)` and returns it in `ready`. The grant is fixed for the session's life. | The relay is authoritative, and the page shows the real value. HIGH. | Setting grace later with a separate frame: no use case yet, since `08` S-06 freezes the value per terminal. | No change to grace mid-session. Revisit with a `regrace` frame if users ask for it.
A3, reversible policy | Operator env `KEEPALIVE_MAX_SECONDS`: an integer >= 0 or `unlimited`. Default `3600`. `0` disables v2 (v1 only). It replaces T11's separate opt-in flag. | One knob, matching the user decision. A default cap of 1 h means the 2-min default works without operator action. MED. | A separate enable flag plus a cap: two knobs that can contradict each other. | v2 is on by default. **Security review must confirm** (see T-06). Revisit if the review keeps v2 off for wildcard origins.
A4, one-way contract | **Cap discovery: both.** `GET <relay http(s) URL>/capabilities` returns `{"protocols":[1,2],"resume":bool,"maxGraceMs":int\|null}` to feed the Settings UI before connecting. `ready.grantedGraceMs` and `ready.capGraceMs` are authoritative per session. | Settings needs the cap before any connection (`08` Q-01), and the session needs a value it can rely on. MED. | Ready field only: no pre-connect UI state. A pre-connect probe frame costs a WebSocket and a handshake. | The relay needs an HTTP handler and allowlist CORS. A cross-origin relay must answer CORS.
A5, reversible | **The page sends v2 only when `/capabilities` returned `resume:true` on this page load.** Unknown (fetch failed, 404 or 426 from a v1 relay, CORS failure) or `resume:false` means v1. Fetch again at connect time if the last result was unknown. | v1 relays reject v2 frames, and this removes downgrade guessing. "No downgrade after v2 started" (T11) still holds. HIGH. | Try v2, then fall back on close: a v1 close cannot be told apart from a network failure, and a retry doubles the connect cost. | A transient fetch failure gives that terminal no keep-alive. Settings K-06 copy must say so (handoff to the UI designer).
A6, one-way contract | **Explicit close frame** `[2,"close"]` from the page: the relay revokes at once and destroys TCP. Disconnect, shell exit and tab close all send it when they can. | Today `wsconn` `resumeState.close()` only closes the WebSocket, and the relay treats that as a detach. A deliberate disconnect then holds TCP for the full grace, which is unbounded under `unlimited`. HIGH (code inspection). | Relying on grace expiry: unacceptable when the cap is unlimited. | Nothing ruled out.
A7, reversible | **Application heartbeat:** the page sends `[2,"ping"]` every 20 s while attached, and the relay replies `[2,"pong"]`. Any client frame counts as liveness. If the relay hears nothing for 90 s, it terminates the socket and detaches, which starts grace. The page closes and resumes after 90 s without a relay frame. | The relay has no liveness check (`local-relay.ts` has no ping). A suspended iOS page can leave the socket looking open, so the session stays attached and grace never starts. A protocol ping may still get a pong from the browser's network layer while the page JS is suspended (SUSPECTED), so it cannot tell whether the page is running. The 90 s window survives hidden-tab timer throttling of about one wake-up per minute. MED. | WebSocket protocol ping: it can be answered without page JS. A shorter timeout: false detaches in throttled desktop tabs. | Effective hold can reach the choice plus 90 s. Document it. Tune from device data.
A8, reversible | **Takeover:** a `resume` with the current token replaces a still-attached socket (the relay closes the old one) instead of rejecting with `session_closed`. | It covers the up-to-90 s window before the relay notices a dead socket. Any holder of the current token can already attach once the session detaches, so takeover adds no new power. MED. | Rejecting a second attachment (T6 today): a returning user is locked out until the heartbeat timeout. | Reverses T6's "one attachment" rejection test. Exactly one attachment still holds at any time.
A9, reversible | **Token rotation, two-phase:** `resumed` carries a new token. The relay accepts the previous token only until the first client frame arrives on the new attachment, then drops it. | It shrinks the life of a stolen token to one attach cycle. Two-phase handles a `resumed` frame lost in transit. Pages send nothing before they receive `resumed` (current `wsconn` flushes only in the `resumed` handler). MED. | No rotation: a token stolen at `ready` stays valid for hours under long grace. Strict single use: a lost `resumed` kills the session. | Nothing ruled out.
A10, reversible | **Capacity:** active plus detached sessions count against `MAX_SESSIONS`. At capacity, a new v2 or v1 connect revokes the oldest detached session (`retention_exceeded`). The relay refuses only when every session is attached. | Grace length does not change memory per session (reads pause at the cap). It changes how many sockets stay held. Orphans from closed or evicted tabs cannot be resumed (the token exists only in page memory), so they must give way to live users. MED. | Refusing new connects at capacity: orphans would block real users for up to the cap, or forever under `unlimited`. | A busy relay can end a user's long keep-alive early. The page shows Session expired.
A11, reversible | **Buffer full: pause TCP reads, never drop.** Unchanged from D2 and now confirmed for long grace. The global detached budget counts retained output, client history and pending input, not only retained output. | Dropping a byte breaks the SSH MAC and sequence, which kills the session anyway. Pausing pushes back through TCP to sshd, and the remote process blocks on PTY or SFTP writes. HIGH. | Drop-oldest: data corruption. | A noisy remote job stalls for the whole time the page is away. Document it, and recommend `tmux` for jobs that must keep running.
A12, reversible | Call `setKeepAlive(true, 60_000)` on v2 target sockets. | Long grace leaves the relay-to-server path idle, and NAT or firewall state can expire. Node 26 API, per `03` F1. MED. | None. | It cannot satisfy server `ClientAliveInterval`. See F-A3.
A13, one-way | **Reject relay-side transfer completion.** | The relay would need SSH credentials or a delegated key, host-key trust, plaintext file data and storage of user files. That breaks D1 and the "no server-side credential custody" assumption. HIGH. | None. | No background progress while iOS suspends the page. Revisit only if the product accepts a server-side SSH trust boundary.
A14, reversible | **Transfers within grace continue on the same SSH connection.** No transfer-specific protocol is needed: SFTP rides the resumed `net.Conn`. The page must not abort in-flight transfers on `pagehide` or `visibilitychange` for v2 sessions. | pkg/sftp v1.13.12 has no request timeout (no timeout or deadline found in `client.go`). Requests wait while the transport is detached. HIGH for the mechanism, MED until E2E proves it. | Cancel and retry: loses work and contradicts the requirement. | It depends on T9's keepalive pause. Otherwise three missed probes (45 s) can close SSH right after resume.
A15, reversible | **Download resume after expiry, or after page eviction, by byte offset:** write the download to OPFS in 4 MiB segment files, each closed (committed) when full. A persisted transfer record makes it possible to resume after a fresh verified login (§6). | A `createWritable` stream commits nothing until `close()` (WHATWG FS spec), so one long stream loses all progress on eviction. Segments commit as they go. `new Blob([...segment Files])` builds the final file without copying it. MED. | One stream with periodic close and reopen using `keepExistingData`: copies the whole file at each checkpoint, which is quadratic. `FileSystemSyncAccessHandle`: in place, but only in a dedicated worker (WHATWG FS spec), adding a worker component. | Up to 4 MiB is fetched again after eviction. Without `createWritable` (older Safari), resume works only while the page is alive, within the existing 16 MiB in-memory limit.
A16, reversible | **Upload:** continues within grace (A14). After expiry with the page still alive, resume from the client-tracked contiguous offset on the existing staged temp file. After eviction, restart, because the `File` object is gone and the user picks the file again. Defer offset resume to a separate task. | pkg/sftp concurrent writes (`UseConcurrentWrites`, 16 in flight) can leave holes, so the remote temp file size is not a safe resume offset. MED. | Resuming from the remote file size: risk of silent corruption. | Large uploads interrupted by eviction start over.

## 3. Protocol deltas (v2, amended in place)

Frame | Before (T3) | After
--- | --- | ---
connect (page to relay) | `[2,"connect",host,port]` | `[2,"connect",host,port,requestedGraceMs]`, where `requestedGraceMs` is an int in 1..2^53-1 or `null` (until disconnect). `0` is invalid, because Off uses v1 (A1).
ready (relay to page) | `[2,"ready",sid,token,expiresAt,maxUnackedBytes,graceMs<=120000]` | `[2,"ready",sid,token,maxUnackedBytes,grantedGraceMs,capGraceMs]`. Grant and cap are an int or `null` (unlimited). `expiresAt` is dropped: it described a creation deadline that nobody used (T6/T7 notes). The page counts grace locally from each detach, using relative time with no clock skew.
resume | unchanged | unchanged (sid, token, clientAck, serverAck)
resumed | `[2,"resumed",clientAck,serverAck]` | `[2,"resumed",clientAck,serverAck,newToken]` (A9)
close (page to relay) | absent | `[2,"close"]`: immediate revoke (A6)
ping / pong | absent | `[2,"ping"]` from the page, `[2,"pong"]` from the relay (A7)
error codes | expired, offset_mismatch, invalid_frame, session_closed, retention_exceeded | add `resume_disabled` (v2 connect while the cap is 0) and `superseded` (sent to the old socket on takeover, A8)

Page rules: count the grant from the moment the page observes loss. With a `null` grant, keep no local deadline. On return (`pageshow`, visible, `online`), always attempt **one** resume even if the local deadline has passed, because the relay is authoritative and its timer may have started up to 90 s later. Between attempts, back off 0.5 s, doubling to a 30 s ceiling, and reset on those events. The current fixed 300 ms loop would retry for an hour under long grace.

Capability endpoint: `GET`, no body, `Cache-Control: no-store`. CORS echoes only allowlisted origins, using the same `ALLOWED_ORIGINS` and same-origin policy as the WebSocket. It reveals nothing beyond the cap and protocol support.

## 4. Limits

Limit | Value | Enforced by | On breach | Confidence
--- | --- | --- | --- | ---
Operator cap | `KEEPALIVE_MAX_SECONDS`, default 3600, `unlimited` allowed, 0 = v1 only | relay | the grant is clamped | user decision
User choice | Off, 120, 300, 600, 900, 3600 s, until disconnect | page | none | user decision
Server output retained per session | 256 KiB (existing) | relay | pause TCP reads | LOW, unmeasured
Client input pending per session | 256 KiB relay, 256 KiB `wsconn` (existing) | both | page: `Write` blocks; relay: `retention_exceeded` | LOW
Client history per session | 256 KiB (existing, needed for dedupe) | relay | trimmed | HIGH (follows the pending cap)
Worst-case heap per session | about 768 KiB detached, about 896 KiB attached (adds 128 KiB WebSocket buffer) | derived | none | MED, arithmetic on the constants
Detached byte budget | 16 MiB total across retained, history and pending (A11) | relay | revoke the oldest detached | LOW
Held TCP sockets | `MAX_SESSIONS`, default 256, active plus detached | relay | evict the oldest detached, refuse when all are attached (A10) | MED
Worst-case total heap | 256 x 896 KiB = 224 MiB | derived | none | MED; operators size `MAX_SESSIONS` to fit their RAM
Heartbeat | 20 s interval, 90 s silence | both | detach | LOW, device test
Resume failures | 20 per remote address per minute | relay | close before session lookup | LOW; the 256-bit token makes brute force infeasible, so this limits noise
Download segment | 4 MiB | page | none | LOW, a tuning value

Memory does not grow with grace length. Grace multiplies only how long sockets and per-session constants stay held. Under `unlimited`, tabs that were closed or evicted leave orphans until capacity eviction, relay restart, or server-side close. A6 and A10 bound the damage. Reaping by revoke-on-reload (a revoke-only credential in `sessionStorage`) is deferred until the expiry-cause metric shows many orphans.

## 5. Threat notes

- T-01 | The theft window grows from 120 s to the cap, or without limit. Mitigations: rotation per attach (A9), revoke on close (A6), token kept only in page memory (D4, unchanged), WSS for network exposure. Impact unchanged: a thief can hijack or disrupt the TCP stream but cannot read or forge SSH packets. Injecting bytes causes a MAC failure, so the realistic harm is denial of service.
- T-02 | No IP binding: phones move between Wi-Fi and cellular on resume. Binding to origin stays (it stops cross-site browsers, not forged clients). The token remains the real gate.
- T-03 | Takeover (A8) needs the current token. After the first rotation, a token stolen at `ready` is dead. The legitimate page sees `superseded` and shows Session expired, never a silent split.
- T-04 | The local device holds the real long-grace risk: an unlocked phone with the page open gives access to a signed-in terminal. `08` risk text covers this. Keep it always visible.
- T-05 | The capability endpoint is unauthenticated and read-only, behind allowlist CORS. It exposes nothing beyond the cap.
- T-06 | Default-on v2 (A3), including all-in-one with `ALLOWED_ORIGINS=*`. Resume adds no cross-origin capability beyond v1 connect, because a resume needs the 256-bit token. **The security reviewer must sign off.** This closes plan finding F-01 only after that sign-off.
- T-07 | Persisted transfer records (A15) store host, port, username, remote path, size, mtime and segment names in the origin's IndexedDB. They store no credentials and no tokens. The partial file data is user data in origin storage: delete it on completion, on cancel, and when a record is older than 24 h.

## 6. Transfers across iOS backgrounding

Within grace (required, no loss, no restart): the SFTP requests stay pending in WASM, and the relay holds at most 256 KiB, then pauses sshd. On resume, `wsconn` replays and pkg/sftp continues from the bytes it has. Requirements: A14; T9 pauses keepalives while detached; `FilePanel` aborts nothing on `pagehide` (its current `onHide` releases only the finished held copy, which is correct); progress shows "Paused, reconnecting", not failure. SUSPECTED: an open OPFS writable stream survives page suspension. Device test.

After expiry, with the page alive or evicted (A15):

- Where the data lives: OPFS segment files `localssh-dl-<id>-<n>`. The record lives in IndexedDB: `{id, host, port, user, remotePath, size, mtime, committedBytes, segments}`. It is updated after each segment `close()`.
- iOS storage: Safari 17+ gives browser apps up to 60% of disk per origin. Eviction is best-effort LRU, and `persist()` is granted heuristically (WebKit storage policy). So a partial download may disappear. Restart cleanly if any segment is missing.
- Resume: after a fresh verified login to the same host, port and user, Stat the remote file. If size and mtime match the record, read 4 KiB before `committedBytes` from the server and compare it with the local tail. On a match, Open, `Seek(committedBytes)`, and `WriteTo`. pkg/sftp `WriteTo` starts at the handle offset (`client.go:1493`, v1.13.12). Any mismatch restarts from 0 with the notice "The file changed on the server".
- Engine API delta: `download(path, onChunk, onProgress, {offset, expectSize, expectMtime})`, which reports `{size, mtime}` at start. Finish with `new Blob(segmentFiles)` and a save link.
- `sweepDownloads()` runs on mount and must keep segments that have a live record (today it deletes every leftover file).

Uploads: A16.

## 7. Finishing T8 from the half-applied state

Inspected with `git diff`. No code was modified. Keep every file and revise as listed. Do not discard: the transport core (offset and ACK state, replay, bounded pending and received buffers, deadline-aware waits) follows D3 and T7.

File | Disposition | Required revisions
--- | --- | ---
`engine/wsconn/wsconn.go` (+540) | **Keep, revise** | (1) The `ready` parser hard-codes `grace <= 120000` and `limit == 256 KiB`: parse the new shape, accept `null`, and size `received` and `pending` caps from `maxUnackedBytes`. (2) Send `requestedGraceMs` in `connect`. (3) `resumeState.close()` must send `[2,"close"]` before closing the socket (A6). (4) `retry()`: exponential backoff, at least one attempt after return, no deadline for a `null` grant. (5) Handle the `resumed` new token, and stop the old token after the first frame. (6) Add the 20 s ping and 90 s silence detection. (7) Coalesce server ACKs (today `read` sends one JSON frame per `Read`), for example every 32 KiB or 50 ms. (8) Map `superseded` and `resume_disabled` to clear errors. No Go unit seam exists (`js` build); prove it through E2E.
`engine/main.go` (+23) | **Keep, revise** | Pass the requested grace from callbacks. The asynchronous close for resumable sessions is fine once `Close` sends the close frame. Report close errors through `onClose`, not drop them. The `detach` and `resume` handle functions stay.
`frontend/src/ssh/engine.ts` (+8) | **Keep, revise** | Add `keepAliveMs: number \| null` to `ConnectOptions` (absent means v1). Expose the granted grace and cap to the caller from the first `connected` status, for the Settings and status UI.
`relay/scripts/run-local-relay.ts` (+7/-1) | **Keep** | `--resumable` is acceptable for E2E. T11 replaces it with the `KEEPALIVE_MAX_SECONDS` parsing shared with `run-relay.ts`.
`frontend/e2e/connect-flow.spec.ts` (+191, in T8's write set) | **Keep, revise** | Accept the echo-marker byte-exactness check in place of the "side-effecting shell command" from T8's blocker. A duplicated or lost input range shows up as a doubled or missing echo, and the transport invariant concerns bytes, not commands. Replace the fixed port 8788 with a free port, because CI shards run in parallel. Update it for the new frames. Add close-revokes and takeover cases.

Order: land the relay and protocol deltas (T3a, T6a below) first, then finish T8 against them. The pre-existing two-session E2E timeout (`connect-flow.spec.ts:315`, T9 report) stays a separate defect. Fix it before relying on this spec in CI.

## 8. Test plan additions

Relay (Vitest, fake timers):
- The grant equals `min(requested, cap)` for every option; `null` with `null` stays unlimited; `0` and non-integers are rejected; a cap of 0 answers `resume_disabled`.
- Per-session grace timer fires at the grant; an unlimited session never expires but is revoked on shutdown and under capacity pressure.
- `close` destroys TCP immediately; a WebSocket close without `close` detaches.
- 90 s of silence detaches; data and ack frames reset the timer; ping gets a pong.
- Takeover with the current token: the old socket gets `superseded`. Rotation: a lost `resumed` still allows one retry with the old token, which fails after the first frame on the new attachment.
- Capacity: at `MAX_SESSIONS`, a connect evicts the oldest detached session and is refused when all are attached; v1 connects follow the same rule.
- The detached budget counts all three buffers. One simulated hour of steady target output while detached keeps heap-retained bytes at or below the caps.
- Target `setKeepAlive` is called. Capabilities: JSON shape, allowlist CORS, wildcard, disabled, GET only, no token anywhere in logs.

Engine and E2E (Chromium, then WebKit):
- Off: the page sends v1 frames only and closes on `pagehide`.
- Unknown or disabled capability: v1. Capability true: v2 with the requested grace.
- Transport drop mid-download, with a small relay cap forcing backpressure: the result hash equals the source and progress is monotonic. Same for upload, checked with a remote hash.
- Download after expiry: new login, resume from the offset, hash equal. A remote file changed by mtime, size or tail bytes restarts from 0 with the notice.
- Reload with committed segments: resume offered after login. A missing segment restarts cleanly.
- Explicit Disconnect frees the relay socket at once (relay log or session count).
- The returning page resumes after its local deadline when the relay still holds the session.
- Settings states K-01 to K-07 against a mocked endpoint.

Release gate (physical iPhone, adds to `05`): background for 30 s, 3 min, 20 min and 70 min with the cap at 1 h, during a 200 MB download. Measure when the relay detects loss, whether the download continues without loss inside grace, the expiry and offset-resume path beyond grace, the lock screen, a Wi-Fi to cellular switch, eviction, then reload and resume. Record the OPFS stream behaviour across suspension.

## 9. Task changes for the planner

- **T3a (new, blocks T6a/T8):** protocol deltas from §3 in `protocol.ts` and its tests. Amend in place; v1 stays byte-identical.
- **T6a (new, after T3a):** per-session grant and cap option (`maxGraceMs: number | null`, with 0 disabling v2), close frame, heartbeat timeout, takeover, rotation, capacity eviction, full byte accounting, `setKeepAlive`. This replaces T6's "one attachment" rejection test. If it exceeds 300 lines, split it: grant, close and capacity first; liveness, takeover and rotation second.
- **T6b (new, parallel with T6a):** `/capabilities` handler for standalone (the relay creates its own HTTP server and passes `server` to `ws`) and for all-in-one (`web-server.ts`), with CORS tests.
- **T8 (revised):** finish from the half-applied state per §7. Requested grace, close, rotation, heartbeat, backoff, ACK coalescing. The echo proof replaces the shell side effect. Drop the test-server blocker.
- **T9 (revised):** keepalive pause while detached, plus continuation of in-flight transfers within grace (A14). "Fail visibly" applies only on expiry, and points the user to T13.
- **T10 (revised):** detach on `pagehide` only, not on hidden (desktop hidden tabs keep transferring; the A7 heartbeat covers iOS suspension). Resume on `pageshow`, visible or `online` with §3 backoff. Off and v1 keep close-on-`pagehide`. Keep each terminal's granted value for status text.
- **T12 (new, the `08` Settings dialog):** replace `TerminalSettings`, add the persisted `keepAlive` field to `settingsStore` (default 120 s, `saveTerminalSettings` returns a result), fetch capabilities per A5, apply only to new terminals. Hand the K-06 copy change to the UI designer and writer.
- **T13 (new, after T9):** download resume after expiry or eviction (A15). Engine `download` offset API, segmented OPFS writer, IndexedDB record, identity and tail check, `sweepDownloads` change.
- **T14 (deferred):** upload offset resume while the page is alive (A16).
- **T11 (revised):** `KEEPALIVE_MAX_SECONDS` in `run-relay.ts`, `run-all-in-one.ts` and `run-local-relay.ts`, validated. Document: the options, the cap, what `unlimited` means (orphans until capacity eviction or restart), the 90 s detection lag, stalled output while away, server `ClientAliveInterval` ending sessions early, single-instance routing, restart loss, `tmux`, `MAX_SESSIONS` RAM sizing (§4), transfer continuation and resume. Help and the README follow.
- Remove from `05`: the 120 s grace, `graceMs <= 120000`, the "one attachment" rejection, and the separate v2 opt-in. Update finding F-01 to "pending security sign-off on default-on v2 (T-06)".

## 10. To verify, assumptions, handoffs

- F-A1 SUSPECTED: an iOS page suspended in the background may leave its WebSocket open, or may answer protocol pings without JS. A7 assumes the worst case. Device test.
- F-A2 SUSPECTED: an open `FileSystemWritableFileStream` survives page suspension. If it does not, a within-grace download falls back to T13's offset resume from the last committed segment.
- F-A3 Server settings: OpenSSH `ClientAliveInterval` and `ClientAliveCountMax` on target hosts can end a session while the page cannot answer. That is outside relay control. Document it and measure on target hosts.
- F-A4 Safari support for `createWritable`: MDN marks it Baseline 2025, and the code comment says Safari 26. Confirm the iOS version floor in MDN's compatibility table before T13.
- All numeric limits are starting values (LOW) until measured. Grace length does not change bytes per session.
- Sources, accessed 2026-11-02: [WHATWG File System, createWritable commit-on-close and SyncAccessHandle worker-only](https://fs.spec.whatwg.org/); [MDN createWritable](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createWritable); [WebKit storage policy, Safari 17](https://webkit.org/blog/14403/updates-to-storage-policy/). pkg/sftp v1.13.12 behaviour comes from local module source.
- Handoffs: security (T-06, rotation and takeover review); UI designer and writer (K-06 copy, transfer "Paused, reconnecting" and "file changed" states, Help topic); engineering (T3a to T14); operations (`MAX_SESSIONS` sizing against RAM, server ClientAlive audit).
