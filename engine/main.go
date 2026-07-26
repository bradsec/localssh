//go:build js && wasm

package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"sync"
	"syscall/js"
	"time"

	"engine/sshclient"
	"engine/wsconn"
)

func main() {
	js.Global().Set("sshConnect", js.FuncOf(sshConnect))
	registerVaultExports()
	select {} // keep the WASM program alive to service callbacks
}

// sshConnect(relayWsUrl, host, port, username, password, callbacks) -> Promise<handle>
// password: a string, or { fromVault: "<entryId>" } to use a saved password
// callbacks: { onHostKey(fingerprint) -> bool, onData(Uint8Array), onClose() }
// handle: { write(Uint8Array), resize(cols, rows), close() }
func sshConnect(this js.Value, args []js.Value) any {
	handler := js.FuncOf(func(this js.Value, resolveReject []js.Value) any {
		resolve, reject := resolveReject[0], resolveReject[1]
		if err := validateConnectArgs(args); err != nil {
			reject.Invoke(err.Error())
			return nil
		}

		relayWsURL := args[0].String()
		host := args[1].String()
		port := args[2].String()
		username := args[3].String()
		password, err := resolvePassword(args[4])
		if err != nil {
			reject.Invoke(err.Error())
			return nil
		}
		callbacks := args[5]

		go connect(relayWsURL, host, port, username, password, callbacks, resolve, reject)
		return nil
	})

	promise := js.Global().Get("Promise").New(handler)
	handler.Release()
	return promise
}

// resolvePassword accepts either a typed password or a reference into the
// unlocked vault. A saved password is read here and never handed to the page.
func resolvePassword(arg js.Value) (string, error) {
	switch arg.Type() {
	case js.TypeString:
		return arg.String(), nil
	case js.TypeObject:
		entryID := arg.Get("fromVault")
		if entryID.Type() != js.TypeString {
			return "", errors.New("password object must carry a fromVault string")
		}
		return vaultPassword(entryID.String())
	default:
		return "", errors.New("password must be a string or a fromVault object")
	}
}

func validateConnectArgs(args []js.Value) error {
	if len(args) != 6 {
		return fmt.Errorf("sshConnect requires 6 arguments")
	}
	callbacks := args[5]
	if callbacks.Type() != js.TypeObject {
		return fmt.Errorf("callbacks must be an object")
	}
	for _, name := range []string{"onHostKey", "onData", "onClose"} {
		if callbacks.Get(name).Type() != js.TypeFunction {
			return fmt.Errorf("callbacks.%s must be a function", name)
		}
	}
	return nil
}

// connectTimeout bounds relay dial plus SSH handshake and authentication.
// Without it a relay that accepts the socket but never speaks leaves the UI
// stuck on "Connecting" with no way back except a page reload.
const connectTimeout = 30 * time.Second

func connect(relayWsURL, host, port, username, password string, callbacks, resolve, reject js.Value) {
	ctx, cancel := context.WithTimeout(context.Background(), connectTimeout)

	conn, err := wsconn.Dial(ctx, relayWsURL, host, port)
	if err != nil {
		cancel()
		reject.Invoke(err.Error())
		return
	}

	verify := func(hostPort string, fp sshclient.HostKeyFingerprint) error {
		accepted, err := callJS(callbacks, "onHostKey", string(fp))
		if err != nil {
			return err
		}
		if !accepted.Truthy() {
			return errors.New("host key rejected")
		}
		return nil
	}

	session, err := sshclient.Connect(ctx, conn, net.JoinHostPort(host, port), username, password, verify)
	if err != nil {
		cancel()
		rejectWithCleanup(reject, err, conn.Close())
		return
	}

	if err := session.RequestPTY(80, 24); err != nil {
		cancel()
		rejectWithCleanup(reject, err, session.Close())
		return
	}

	bridge := &sessionBridge{
		cancel:    cancel,
		session:   session,
		callbacks: callbacks,
	}
	handle := bridge.handle()
	resolve.Invoke(handle)
	go bridge.read()
}

func rejectWithCleanup(reject js.Value, primary, cleanup error) {
	if cleanup != nil {
		primary = errors.Join(primary, fmt.Errorf("cleanup: %w", cleanup))
	}
	reject.Invoke(primary.Error())
}

func callJS(object js.Value, method string, args ...any) (value js.Value, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("callbacks.%s: %v", method, recovered)
		}
	}()
	return object.Call(method, args...), nil
}

type sessionBridge struct {
	cancel    context.CancelFunc
	session   *sshclient.Session
	callbacks js.Value

	closeOnce sync.Once
	funcs     []js.Func
}

func (b *sessionBridge) handle() js.Value {
	write := js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) != 1 {
			return "write requires one Uint8Array argument"
		}
		// Reading .byteLength off a non-buffer panics, and an unrecovered
		// panic inside a js.Func kills the WASM instance for the whole page.
		if !args[0].InstanceOf(js.Global().Get("Uint8Array")) {
			return "write requires one Uint8Array argument"
		}
		data := make([]byte, args[0].Get("byteLength").Int())
		js.CopyBytesToGo(data, args[0])
		if _, err := b.session.Write(data); err != nil {
			return err.Error()
		}
		return nil
	})
	resize := js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) != 2 {
			return "resize requires cols and rows"
		}
		if args[0].Type() != js.TypeNumber || args[1].Type() != js.TypeNumber {
			return "resize requires numeric cols and rows"
		}
		if err := b.session.Resize(args[0].Int(), args[1].Int()); err != nil {
			return err.Error()
		}
		return nil
	})
	closeSession := js.FuncOf(func(this js.Value, args []js.Value) any {
		if err := b.close(); err != nil {
			return err.Error()
		}
		return nil
	})
	b.funcs = []js.Func{write, resize, closeSession}

	return js.ValueOf(map[string]any{
		"write":  write,
		"resize": resize,
		"close":  closeSession,
	})
}

func (b *sessionBridge) read() {
	buf := make([]byte, 4096)
	for {
		n, err := b.session.Read(buf)
		if n > 0 {
			jsBuf := js.Global().Get("Uint8Array").New(n)
			js.CopyBytesToJS(jsBuf, buf[:n])
			if _, callbackErr := callJS(b.callbacks, "onData", jsBuf); callbackErr != nil {
				_ = b.close()
				return
			}
		}
		if err != nil {
			_ = b.close()
			return
		}
	}
}

func (b *sessionBridge) close() error {
	var closeErr error
	b.closeOnce.Do(func() {
		b.cancel()
		closeErr = b.session.Close()
		if _, err := callJS(b.callbacks, "onClose"); err != nil {
			closeErr = errors.Join(closeErr, err)
		}
		for _, fn := range b.funcs {
			fn.Release()
		}
		b.funcs = nil
	})
	return closeErr
}
