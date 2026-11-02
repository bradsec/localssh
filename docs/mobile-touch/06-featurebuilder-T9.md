# T9 feature builder report

Building: pause SSH keepalives during transport detachment and report interrupted SFTP transfers for browser SSH users; done means resumed sessions regain normal probes and transfers never claim false completion.

## Blocker

T9 is blocked by T8 (`05-implementationplanner.md:112-120`). T8 stopped before implementation (`06-featurebuilder-T8.md:7-9`). The current WASM transport still has a single WebSocket, closes its `net.Conn` on socket loss, and exposes no detach or resume state (`engine/wsconn/wsconn.go:91`, `engine/wsconn/wsconn.go:364`). `sshConnect` still calls that v1 dial path (`engine/main.go:133`). T9 cannot pause and restart keepalives around a transport transition that does not exist. Implementing such a transition would require changing T8 files outside T9's write set. The plan says to stop when it conflicts with the code.

Assumption: T8 must supply a resumable connection and transport status before T9 begins. Confidence HIGH: the named T8 report and current call path agree.

## Work

- Code files changed: none. Tests added: none. No branch or commit created.
- Files changed: this report only.
- Keepalive design, once unblocked: reuse the existing `runKeepalives` loop and its fake connection test seam (`engine/sshclient/client.go:158`, `engine/sshclient/keepalive_test.go:11`). Confidence MED: the transport state interface is not yet defined.
- Transfer design, once unblocked: retain the current staged-upload cleanup contract (`engine/main.go:306`) and require observable failure or safe continuation. Confidence MED: resumable SFTP behavior is not yet testable.
- Out of scope: transport v2 implementation, test-server changes, and unrelated E2E failures.

## Checks

From `engine/`:

```text
$ rtk go test ./sshclient ./...
Go test: 102 passed in 5 packages
```

From `frontend/`:

```text
$ rtk npm run test:e2e -- e2e/connect-flow.spec.ts --browser=chromium --reporter=line
  1) [chromium] › e2e/connect-flow.spec.ts:273:1 › keeps two live terminal sessions and closes only the selected one
    Test timeout of 30000ms exceeded.
    Error: locator.boundingBox: Test timeout of 30000ms exceeded.
    Call log:
      - waiting for getByRole('tab', { name: '127.0.0.1, connected' }).first()
      313 |     .getByRole("tab", { name: `${host}, connected` })
      314 |     .first()
    > 315 |     .boundingBox();
          |      ^
      316 |   expect(tabSize!.height).toBeGreaterThanOrEqual(44);
      317 |
      318 |   await page
        at frontend/e2e/connect-flow.spec.ts:315:6
  1 failed
    [chromium] › e2e/connect-flow.spec.ts:273:1 › keeps two live terminal sessions and closes only the selected one
  15 passed (49.4s)
```

The E2E failure is an observed adjacent problem, not attributed to T9. Its cause is unverified. Existing Go tests and E2E cases do not exercise T9 because no T9 code or tests were added.

## Notes for the lead

- Complete or replan T8 before assigning T9. T8 reports a test-server write-set conflict at `06-featurebuilder-T8.md:7-9`.
- T9's named write set has no dirty files at this checkpoint. Other builders' files were untouched.
- Resolve the two-session E2E timeout separately; it occurred at `frontend/e2e/connect-flow.spec.ts:315` during verification.
- Unverified: keepalive pause/resume, real expiry, transfer interruption and false-success behavior, because T8's resumable transport is absent.
