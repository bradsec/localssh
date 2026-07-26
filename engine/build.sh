#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p dist

GOOS=js GOARCH=wasm go build -o dist/engine.wasm .

WASM_EXEC="$(go env GOROOT)/lib/wasm/wasm_exec.js"
if [ ! -f "$WASM_EXEC" ]; then
  WASM_EXEC="$(go env GOROOT)/misc/wasm/wasm_exec.js"
fi
cp "$WASM_EXEC" dist/wasm_exec.js

go build -o dist/testsshd ./cmd/testsshd

echo "built dist/engine.wasm, dist/wasm_exec.js, dist/testsshd"
