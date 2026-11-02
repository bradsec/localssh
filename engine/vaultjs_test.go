//go:build js && wasm

package main

import (
	"strings"
	"syscall/js"
	"testing"
)

func TestVaultUpsertRejectsUnknownTerminalPreference(t *testing.T) {
	if _, err := vaultCreate([]js.Value{js.ValueOf("test password")}); err != nil {
		t.Fatalf("create vault: %v", err)
	}
	t.Cleanup(func() { _, _ = vaultLock(nil) })

	request := `{"id":"entry","nickname":"entry","host":"example.com","port":22,"username":"user","terminal":{"fontFamily":"monospace","fontSize":14,"lineHeight":1.2,"themeName":"dark","themeNmae":"dark"}}`
	_, err := vaultUpsert([]js.Value{js.ValueOf(request)})
	if err == nil || !strings.Contains(err.Error(), `unknown field "themeNmae"`) {
		t.Fatalf("vaultUpsert error = %v, want unknown terminal preference", err)
	}
}
