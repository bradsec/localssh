//go:build js && wasm

package wsconn

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"sync"
	"syscall/js"
	"time"
)

const maxBufferedReadBytes = 4 * 1024 * 1024

// A failed WebSocket handshake reaches page scripts as a bare error event: the
// browser withholds the status code and body, so a relay that answered 403
// because the page origin is not in its allowlist is indistinguishable here
// from a relay that is not running. The message names both causes, because the
// allowlist is the one an operator can fix and the relay log records which it
// was.
var errWebSocketConnect = errors.New(
	"could not reach the relay: it may be down, or it refused this page's origin " +
		"(check ALLOWED_ORIGINS in the relay configuration, and the relay log for the reason)",
)

// Conn implements net.Conn over a browser/Node WebSocket, so sshclient.Connect
// can dial through it exactly as it would a real TCP connection. On open, it
// sends the relay's JSON connect frame ({"host":...,"port":...}) as the first
// message before returning, so the caller can immediately start writing raw
// SSH bytes without needing to know about the relay's handshake.
type Conn struct {
	ws js.Value

	readMu            sync.Mutex
	queueMu           sync.Mutex
	queue             [][]byte
	pending           []byte
	bufferedReadBytes int
	notify            chan struct{}

	writeMu   sync.Mutex
	closeCh   chan struct{}
	closeOnce sync.Once

	listenersMu sync.Mutex
	listeners   []eventListener
}

type eventListener struct {
	name string
	fn   js.Func
}

// Dial opens a WebSocket to wsURL, sends the connect frame for host:port,
// and blocks until the socket is open (or errors).
func Dial(ctx context.Context, wsURL, host, port string) (*Conn, error) {
	portNum, err := strconv.Atoi(port)
	if err != nil {
		return nil, fmt.Errorf("invalid port %q: %w", port, err)
	}
	if portNum < 1 || portNum > 65535 {
		return nil, fmt.Errorf("invalid port %q: must be in 1..65535", port)
	}
	frame, err := json.Marshal(map[string]any{"host": host, "port": portNum})
	if err != nil {
		return nil, fmt.Errorf("encode connect frame: %w", err)
	}

	ws, err := newWebSocket(wsURL)
	if err != nil {
		return nil, err
	}
	ws.Set("binaryType", "arraybuffer")

	c := &Conn{
		ws:      ws,
		notify:  make(chan struct{}, 1),
		closeCh: make(chan struct{}),
	}
	dialResult := make(chan error, 1)

	c.addEventListener("open", func(this js.Value, args []js.Value) any {
		sendDialResult(dialResult, nil)
		return nil
	})
	c.addEventListener("error", func(this js.Value, args []js.Value) any {
		sendDialResult(dialResult, errWebSocketConnect)
		return nil
	})
	c.addEventListener("message", func(this js.Value, args []js.Value) any {
		if len(args) == 0 {
			return nil
		}
		// The relay is untrusted: it can send text frames, or binary frames of
		// a type we did not ask for. Reading .byteLength off anything but an
		// ArrayBuffer panics, and a panic in a js.Func tears down the whole
		// WASM instance, so drop non-conforming frames instead.
		data := args[0].Get("data")
		if !data.InstanceOf(js.Global().Get("ArrayBuffer")) {
			return nil
		}
		buf := make([]byte, data.Get("byteLength").Int())
		js.CopyBytesToGo(buf, js.Global().Get("Uint8Array").New(data))

		select {
		case <-c.closeCh:
			return nil
		default:
		}

		c.queueMu.Lock()
		if len(buf) > maxBufferedReadBytes-c.bufferedReadBytes {
			c.queueMu.Unlock()
			c.signalClosed()
			c.ws.Call("close", 1009, "receive buffer limit exceeded")
			return nil
		}
		c.queue = append(c.queue, buf)
		c.bufferedReadBytes += len(buf)
		c.queueMu.Unlock()
		select {
		case c.notify <- struct{}{}:
		default:
		}
		return nil
	})
	c.addEventListener("close", func(this js.Value, args []js.Value) any {
		sendDialResult(dialResult, errWebSocketConnect)
		c.signalClosed()
		return nil
	})

	var dialErr error
	select {
	case dialErr = <-dialResult:
	case <-ctx.Done():
		dialErr = ctx.Err()
	}
	if dialErr != nil {
		if closeErr := c.Close(); closeErr != nil {
			return nil, errors.Join(dialErr, closeErr)
		}
		return nil, dialErr
	}
	if err := c.sendText(string(frame)); err != nil {
		if closeErr := c.Close(); closeErr != nil {
			return nil, errors.Join(fmt.Errorf("send connect frame: %w", err), closeErr)
		}
		return nil, fmt.Errorf("send connect frame: %w", err)
	}
	return c, nil
}

func newWebSocket(wsURL string) (ws js.Value, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("open websocket: %v", recovered)
		}
	}()
	ws = js.Global().Get("WebSocket").New(wsURL)
	return ws, nil
}

func sendDialResult(result chan<- error, err error) {
	select {
	case result <- err:
	default:
	}
}

func (c *Conn) addEventListener(name string, callback func(js.Value, []js.Value) any) {
	fn := js.FuncOf(callback)
	c.ws.Call("addEventListener", name, fn)
	c.listenersMu.Lock()
	c.listeners = append(c.listeners, eventListener{name: name, fn: fn})
	c.listenersMu.Unlock()
}

func (c *Conn) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}

	c.readMu.Lock()
	defer c.readMu.Unlock()

	for {
		if len(c.pending) > 0 {
			n := copy(p, c.pending)
			c.pending = c.pending[n:]
			c.queueMu.Lock()
			c.bufferedReadBytes -= n
			c.queueMu.Unlock()
			return n, nil
		}

		c.queueMu.Lock()
		if len(c.queue) > 0 {
			c.pending = c.queue[0]
			c.queue[0] = nil
			c.queue = c.queue[1:]
		}
		c.queueMu.Unlock()
		if len(c.pending) > 0 {
			continue
		}

		select {
		case <-c.notify:
		case <-c.closeCh:
			c.queueMu.Lock()
			hasQueuedData := len(c.queue) > 0
			c.queueMu.Unlock()
			if !hasQueuedData {
				return 0, io.EOF
			}
		}
	}
}

func (c *Conn) Write(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}

	c.writeMu.Lock()
	defer c.writeMu.Unlock()

	select {
	case <-c.closeCh:
		return 0, net.ErrClosed
	default:
	}
	if err := c.send(p); err != nil {
		return 0, err
	}
	return len(p), nil
}

func (c *Conn) send(p []byte) (err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("websocket send: %v", recovered)
		}
	}()
	if c.ws.Get("readyState").Int() != 1 {
		return net.ErrClosed
	}
	jsBuf := js.Global().Get("Uint8Array").New(len(p))
	js.CopyBytesToJS(jsBuf, p)
	c.ws.Call("send", jsBuf)
	return nil
}

func (c *Conn) sendText(message string) (err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("websocket send: %v", recovered)
		}
	}()
	if c.ws.Get("readyState").Int() != 1 {
		return net.ErrClosed
	}
	c.ws.Call("send", message)
	return nil
}

func (c *Conn) Close() (err error) {
	c.signalClosed()

	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("close websocket: %v", recovered)
		}
		c.releaseListeners()
	}()
	c.ws.Call("close")
	return nil
}

func (c *Conn) signalClosed() {
	c.closeOnce.Do(func() {
		close(c.closeCh)
		select {
		case c.notify <- struct{}{}:
		default:
		}
	})
}

func (c *Conn) releaseListeners() {
	c.listenersMu.Lock()
	defer c.listenersMu.Unlock()

	for _, listener := range c.listeners {
		c.ws.Call("removeEventListener", listener.name, listener.fn)
		listener.fn.Release()
	}
	c.listeners = nil
}

func (c *Conn) LocalAddr() net.Addr                { return stubAddr{} }
func (c *Conn) RemoteAddr() net.Addr               { return stubAddr{} }
func (c *Conn) SetDeadline(t time.Time) error      { return nil }
func (c *Conn) SetReadDeadline(t time.Time) error  { return nil }
func (c *Conn) SetWriteDeadline(t time.Time) error { return nil }

type stubAddr struct{}

func (stubAddr) Network() string { return "websocket" }
func (stubAddr) String() string  { return "websocket" }

var _ net.Conn = (*Conn)(nil)
