//go:build js && wasm

package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"syscall/js"

	"engine/vault"
)

var (
	vaultMu  sync.RWMutex
	unlocked *unlockedVault
)

type unlockedVault struct {
	session  *vault.Session
	document *vault.Document
}

func registerVaultExports() {
	js.Global().Set("vaultCreate", promised(vaultCreate))
	js.Global().Set("vaultUnlock", promised(vaultUnlock))
	js.Global().Set("vaultList", promised(vaultList))
	js.Global().Set("vaultUpsert", promised(vaultUpsert))
	js.Global().Set("vaultDelete", promised(vaultDelete))
	js.Global().Set("vaultChangePassword", promised(vaultChangePassword))
	js.Global().Set("vaultLock", promised(vaultLock))
}

// promised adapts a Go function to a JS function returning a Promise. The work
// runs in a goroutine, but note that Go/wasm shares the page's only thread:
// an Argon2id derivation still blocks rendering, so callers must paint their
// pending state before invoking one of these.
func promised(fn func(args []js.Value) (any, error)) js.Func {
	return js.FuncOf(func(this js.Value, args []js.Value) any {
		handler := js.FuncOf(func(this js.Value, resolveReject []js.Value) any {
			resolve, reject := resolveReject[0], resolveReject[1]
			go func() {
				defer func() {
					if recovered := recover(); recovered != nil {
						reject.Invoke(fmt.Sprintf("vault: %v", recovered))
					}
				}()
				result, err := fn(args)
				if err != nil {
					reject.Invoke(err.Error())
					return
				}
				resolve.Invoke(result)
			}()
			return nil
		})
		defer handler.Release()
		return js.Global().Get("Promise").New(handler)
	})
}

func stringArgs(args []js.Value, want int) ([]string, error) {
	if len(args) != want {
		return nil, fmt.Errorf("vault: expected %d arguments, got %d", want, len(args))
	}
	values := make([]string, want)
	for i, arg := range args {
		if arg.Type() != js.TypeString {
			return nil, fmt.Errorf("vault: argument %d must be a string", i+1)
		}
		values[i] = arg.String()
	}
	return values, nil
}

func vaultCreate(args []js.Value) (any, error) {
	values, err := stringArgs(args, 1)
	if err != nil {
		return nil, err
	}

	session, err := vault.Create(values[0], vault.DefaultParams)
	if err != nil {
		return nil, err
	}
	document := vault.NewDocument()

	blob, err := sealed(session, document)
	if err != nil {
		session.Zero()
		return nil, err
	}
	vaultMu.Lock()
	defer vaultMu.Unlock()
	replaceUnlocked(&unlockedVault{session: session, document: document})
	return blob, nil
}

func vaultUnlock(args []js.Value) (any, error) {
	values, err := stringArgs(args, 2)
	if err != nil {
		return nil, err
	}

	session, plaintext, err := vault.Unlock(values[0], values[1])
	if err != nil {
		return nil, err
	}
	document, err := vault.ParseDocument(plaintext)
	if err != nil {
		session.Zero()
		return nil, err
	}

	vaultMu.Lock()
	defer vaultMu.Unlock()
	replaceUnlocked(&unlockedVault{session: session, document: document})
	return redactedJSON(document)
}

func vaultList(args []js.Value) (any, error) {
	if _, err := stringArgs(args, 0); err != nil {
		return nil, err
	}
	vaultMu.RLock()
	defer vaultMu.RUnlock()
	if unlocked == nil {
		return nil, vault.ErrLocked
	}
	return redactedJSON(unlocked.document)
}

func vaultUpsert(args []js.Value) (any, error) {
	values, err := stringArgs(args, 1)
	if err != nil {
		return nil, err
	}
	vaultMu.Lock()
	defer vaultMu.Unlock()
	if unlocked == nil {
		return nil, vault.ErrLocked
	}

	// Password is a pointer so that an absent field keeps the saved password
	// and an explicit empty string clears it.
	var wire struct {
		ID       string  `json:"id"`
		Nickname string  `json:"nickname"`
		Host     string  `json:"host"`
		Port     int     `json:"port"`
		Username string  `json:"username"`
		Password *string `json:"password"`
	}
	if err := json.Unmarshal([]byte(values[0]), &wire); err != nil {
		return nil, fmt.Errorf("vault: malformed entry: %w", err)
	}

	next := unlocked.document.Clone()
	if err := next.Upsert(vault.EntryUpdate{
		ID:       wire.ID,
		Nickname: wire.Nickname,
		Host:     wire.Host,
		Port:     wire.Port,
		Username: wire.Username,
		Password: wire.Password,
	}); err != nil {
		return nil, err
	}
	blob, err := sealed(unlocked.session, next)
	if err != nil {
		return nil, err
	}
	unlocked.document = next
	return blob, nil
}

func vaultDelete(args []js.Value) (any, error) {
	values, err := stringArgs(args, 1)
	if err != nil {
		return nil, err
	}
	vaultMu.Lock()
	defer vaultMu.Unlock()
	if unlocked == nil {
		return nil, vault.ErrLocked
	}
	next := unlocked.document.Clone()
	if !next.Delete(values[0]) {
		return nil, vault.ErrNoSuchEntry
	}
	blob, err := sealed(unlocked.session, next)
	if err != nil {
		return nil, err
	}
	unlocked.document = next
	return blob, nil
}

func vaultChangePassword(args []js.Value) (any, error) {
	values, err := stringArgs(args, 2)
	if err != nil {
		return nil, err
	}
	vaultMu.Lock()
	defer vaultMu.Unlock()
	if unlocked == nil {
		return nil, vault.ErrLocked
	}

	// Re-seal and reopen under the current password first, so a mistyped
	// current password cannot silently rekey the vault.
	blob, err := sealed(unlocked.session, unlocked.document)
	if err != nil {
		return nil, err
	}
	verified, _, err := vault.Unlock(blob, values[0])
	if err != nil {
		return nil, err
	}
	verified.Zero()

	next, err := vault.Create(values[1], unlocked.session.Params())
	if err != nil {
		return nil, err
	}
	blob, err = sealed(next, unlocked.document)
	if err != nil {
		next.Zero()
		return nil, err
	}
	unlocked.session.Zero()
	unlocked.session = next
	return blob, nil
}

func vaultLock(args []js.Value) (any, error) {
	if _, err := stringArgs(args, 0); err != nil {
		return nil, err
	}
	vaultMu.Lock()
	defer vaultMu.Unlock()
	replaceUnlocked(nil)
	return nil, nil
}

func replaceUnlocked(next *unlockedVault) {
	if unlocked != nil {
		unlocked.session.Zero()
	}
	unlocked = next
}

func sealed(session *vault.Session, document *vault.Document) (string, error) {
	plaintext, err := document.Marshal()
	if err != nil {
		return "", err
	}
	return session.Seal(plaintext)
}

func redactedJSON(document *vault.Document) (string, error) {
	encoded, err := json.Marshal(document.Redacted())
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

// vaultPassword resolves a saved password for sshConnect. It is the only
// reader of a stored password, and it never returns one to JavaScript.
func vaultPassword(entryID string) (string, error) {
	vaultMu.RLock()
	defer vaultMu.RUnlock()
	if unlocked == nil {
		return "", vault.ErrLocked
	}
	password, ok := unlocked.document.PasswordFor(entryID)
	if !ok {
		return "", errors.New("vault: entry has no saved password")
	}
	return password, nil
}
