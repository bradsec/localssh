# F1 SFTP feature build

BASE_F1: `79f1ed8b5719d750638f45bd83117865c3214f8c`

## Lead note

The Codex session reached its usage limit after its final checks and before it wrote the rest of this report. The lead re-ran verification on the uncommitted work: engine `go test ./...` (all packages ok), `GOOS=js GOARCH=wasm go vet ./...`, `./build.sh`; frontend `Tests  314 passed (314)`, `tsc -b`, lint, format check, build; Playwright `22 passed`; `docker build .` succeeded. New dependency: `github.com/pkg/sftp v1.13.12` (latest on proxy.golang.org, published 2026-10-23), justified because x/crypto/ssh has no SFTP client. Uploads write a temporary remote file and rename it into place (`engine/sftpjs.go:226-268`). The spec coverage table and self-review were not written; the change reviewer works from the F1 stub and the diff.
