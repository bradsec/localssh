# Parallel CI

Report for the CI split of 2026-11-01. Files changed: `.github/workflows/quality.yml` and `.github/workflows/release.yml`. `frontend/playwright.config.ts` is unchanged: the workflow passes the blob reporter on the command line (`--reporter=blob`).

## What changed

### quality.yml

The single `test` job is now six jobs. `quality.yml` also accepts `workflow_call`, so `release.yml` can reuse it.

| Job | Runs |
| --- | --- |
| `engine` | go vet (native and wasm), `go test -race`, `./build.sh`, govulncheck (native and wasm) |
| `relay` | npm ci, audit, test, lint, format check, build |
| `frontend-unit` | npm ci, audit, test, lint, format check, `tsc -b`, build |
| `e2e` (matrix, shards 1/2 and 2/2) | Go and Node setup, `npm ci` in relay and frontend, Chromium install, `E2E_COMBINED=1 npx playwright test --reporter=blob --shard=N/2`, blob report upload |
| `e2e-report` | runs when the workflow is not cancelled, after both shards; merges the blobs with `playwright merge-reports --reporter html` and uploads one `playwright-report-attempt-N` artifact (14 days) |
| `image-smoke` | builds `Dockerfile.all-in-one`, runs the container, waits for the healthcheck, curls `/healthz` |

`E2E_COMBINED=1` is kept. In `frontend/playwright.config.ts` it switches the webServer from `vite preview` to the all-in-one relay serving `frontend/dist` (`relay/dist/scripts/run-all-in-one.js`). Both modes first run `../engine/build.sh` and `npm run build`. The global setup starts `engine/dist/testsshd` and a local relay through relay's `tsx`.

Why the e2e job builds the engine itself instead of downloading an artifact from `engine`: the webServer command runs `../engine/build.sh` anyway, so the job needs Go either way. An artifact would also make e2e wait for the full 51s engine job (race tests and govulncheck). With the setup-go module and build cache, `build.sh` is a short step.

Playwright browsers are not cached. The Playwright CI guide (https://playwright.dev/docs/ci, accessed 2026-11-01) says caching browser binaries "is not recommended" because restoring the cache takes about as long as downloading the binaries, and the OS dependencies are not cacheable. The Go module cache and the npm cache work as before (setup-go and setup-node).

The concurrency group is now `quality-${{ github.workflow }}-${{ github.ref }}`. Under `workflow_call`, `github` is the caller's context, so the group becomes `quality-Release-<ref>`. A push that changes VERSION on main starts both Quality and Release, and the different group names stop either run from cancelling the other. GitHub's reusable-workflow reference warns against using the same group in caller and called workflows when `cancel-in-progress` is true. Release's own group is `release`.

### release.yml

- `validate` is unchanged.
- `test` now calls `./.github/workflows/quality.yml` with `contents: read`. It runs everything Quality runs. Before, the Release Test job ran no native `go vet`, no image smoke test and no report merge. Release also ran a plain `go test ./...` before `go test -race ./...`. That run is dropped because the race run executes the same tests.
- `publish` is a three-leg matrix (`frontend`: `Dockerfile`; `relay`: `relay/Dockerfile` with context `relay`; `combined`: `Dockerfile.all-in-one`). Each leg sets up QEMU and Buildx, logs in to GHCR, builds linux/amd64 and linux/arm64, pushes `<image>:<VERSION>`, attests with `push-to-registry`, and uploads its digest as artifact `digest-<name>`. The GHA cache scope is still per image (`scope=frontend|relay|combined`). As before, all three images use the labels that `docker/metadata-action` generates for the combined image. Permissions: `contents: read`, `packages: write`, `attestations: write`, `id-token: write`.
- `release` downloads the three digests and checks each against `^sha256:[0-9a-f]{64}$`. It then promotes each image to `latest` with `docker buildx imagetools create` by digest and creates the GitHub release. This job does not check out the repository, so `gh release create` gets an explicit `--repo "$GITHUB_REPOSITORY"`. Permissions: `contents: write`, `packages: write`.

Unchanged: the triggers (a VERSION change on main, plus `workflow_dispatch`), version validation, the `release` concurrency group, image names, tags, attestations and existing action pins.

## Job graph

```
Quality:  engine | relay | frontend-unit | image-smoke | e2e[1/2, 2/2] -> e2e-report

Release:  validate -> test (Quality via workflow_call) -> publish[frontend, relay, combined] -> release
```

## Pins added

Each SHA comes from `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`. Each tag is the repo's latest release on 2026-11-01.

- `actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2`
- `actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2`

## Validation

- actionlint v1.7.12 (`go run github.com/rhysd/actionlint/cmd/actionlint@latest`): no findings, exit 0.
- Local shards (Node 26, `E2E_COMBINED=1`, from `frontend/`):
  - `--shard=1/2`: `19 passed (18.4s)`
  - `--shard=2/2`: `8 passed (9.7s)`
- Blob reporter and merge: both shards ran with `--reporter=blob`, and `merge-reports --reporter html` built one `index.html`. In that blob run, shard 1 had one failure: `connect-flow.spec.ts:253 › lists the first 10,000 items of a larger folder and reaches the end` (the text "Showing the first 10,000 items in this folder." did not appear within 5s). A rerun of shard 1 passed 19/19. The other agent was editing this spec and the explorer code at the time, so the cause may be a mid-edit tree or a flaky test. It is not caused by the CI change.
- Shard balance: shards split by file because `fullyParallel` is off. Shard 1 gets `address-book` and `connect-flow` (19 tests), and shard 2 gets the rest (8 tests). Setting `fullyParallel: true` would balance them per test. That is not done here because some specs may depend on test order within a file.

## Estimated critical paths

These are estimates built from the measured step times of 2026-11-01. They are not measurements, and they leave out runner queueing and per-job startup (about 5 to 15s per job).

- Quality, 2m44s before. The longest jobs are `engine` (about 8s setup-go + 51s checks, so about 1m) and `e2e` plus `e2e-report`. The e2e path is about 8s setup-go + 5s setup-node + about 8s npm ci + 18s browser install + about 12 to 15s for the larger shard, then about 20s to merge. That is about 1m15s. Estimated critical path: about 1m15s to 1m40s.
- Release, about 13m55s before (9s validate + 3m13s Test + 10m33s Publish). New path: 9s validate + about 1m30s test + the slowest image leg + about 20s promote and release. Per-image times were not measured. If the combined image is about 40 to 50% of the 10m33s, its leg takes about 4m30s to 5m30s. Estimated critical path: about 6m30s to 7m30s.

## Not verified

- No live GitHub Actions run of either workflow yet. Things only a live run can confirm: artifact upload and download across jobs, the reusable workflow call, per-leg GHA cache scopes, and the digest hand-off to `release`.
- Release timings depend on how long each image takes under QEMU, which was not measured.
