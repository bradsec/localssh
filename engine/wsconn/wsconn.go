//go:build js && wasm

package wsconn

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"strconv"
	"sync"
	"sync/atomic"
	"syscall/js"
	"time"
)

const maxBufferedReadBytes = 4 * 1024 * 1024
const maxResumableBytes = 256 * 1024

type GraceInfo struct {
	GrantedGraceMs *int64
	CapGraceMs     *int64
}

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

// CloseError reports a WebSocket that the relay or the network closed after
// it opened. The relay names target failures in the close reason, and the
// page maps that reason to a recovery step. It wraps io.EOF so a reader that
// treats the end of the stream as EOF keeps doing so.
type CloseError struct {
	Code   int
	Reason string
}

func (e *CloseError) Error() string {
	if e.Reason == "" {
		return fmt.Sprintf("relay connection closed (code %d)", e.Code)
	}
	return fmt.Sprintf("relay connection closed: %s (code %d)", e.Reason, e.Code)
}

func (e *CloseError) Unwrap() error { return io.EOF }

// Conn implements net.Conn over a browser/Node WebSocket, so sshclient.Connect
// can dial through it exactly as it would a real TCP connection. On open, it
// sends the relay's JSON connect frame ({"host":...,"port":...}) as the first
// message before returning, so the caller can immediately start writing raw
// SSH bytes without needing to know about the relay's handshake.
type Conn struct {
	ws     js.Value
	resume *resumeState

	readMu            sync.Mutex
	queueMu           sync.Mutex
	queue             [][]byte
	pending           []byte
	bufferedReadBytes int
	notify            chan struct{}

	writeMu   sync.Mutex
	closeCh   chan struct{}
	closeOnce sync.Once
	// closedLocally is set before this side closes the socket, so the close
	// event that follows is not mistaken for the peer's.
	closedLocally atomic.Bool
	peerClose     atomic.Pointer[CloseError]

	deadlineMu      sync.Mutex
	readDeadline    time.Time
	writeDeadline   time.Time
	deadlineChanged chan struct{}

	listenersMu   sync.Mutex
	listeners     []eventListener
	listenersOnce sync.Once
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
		ws:              ws,
		notify:          make(chan struct{}, 1),
		closeCh:         make(chan struct{}),
		deadlineChanged: make(chan struct{}, 1),
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
			c.closedLocally.Store(true)
			c.signalClosed()
			// A page may only close with 1000 or 3000..4999; any other code,
			// including 1009 "message too big", makes the browser throw, and a
			// throw here panics the whole engine. 4009 mirrors 1009.
			c.ws.Call("close", 4009, "receive buffer limit exceeded")
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
		if !c.closedLocally.Load() && len(args) > 0 {
			c.peerClose.Store(&CloseError{
				Code:   args[0].Get("code").Int(),
				Reason: args[0].Get("reason").String(),
			})
		}
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
	if c.resume != nil {
		return c.resume.read(c, p)
	}
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

		if err := c.waitForRead(); err != nil {
			return 0, err
		}
		select {
		case <-c.closeCh:
			c.queueMu.Lock()
			hasQueuedData := len(c.queue) > 0
			c.queueMu.Unlock()
			if !hasQueuedData {
				if closeErr := c.peerClose.Load(); closeErr != nil {
					return 0, closeErr
				}
				return 0, io.EOF
			}
		default:
		}
	}
}

func (c *Conn) waitForRead() error {
	c.deadlineMu.Lock()
	deadline := c.readDeadline
	c.deadlineMu.Unlock()

	if deadline.IsZero() {
		select {
		case <-c.notify:
			return nil
		case <-c.closeCh:
			return nil
		case <-c.deadlineChanged:
			return nil
		}
	}

	wait := time.Until(deadline)
	if wait <= 0 {
		return os.ErrDeadlineExceeded
	}
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case <-c.notify:
		return nil
	case <-c.closeCh:
		return nil
	case <-c.deadlineChanged:
		return nil
	case <-timer.C:
		return os.ErrDeadlineExceeded
	}
}

func (c *Conn) Write(p []byte) (int, error) {
	if c.resume != nil {
		return c.resume.write(c, p)
	}
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
	c.deadlineMu.Lock()
	deadline := c.writeDeadline
	c.deadlineMu.Unlock()
	if !deadline.IsZero() && time.Until(deadline) <= 0 {
		return 0, os.ErrDeadlineExceeded
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

// PeerClose returns how the relay or network closed the socket, or nil when it
// is still open or this side closed it.
func (c *Conn) PeerClose() *CloseError {
	if c.resume != nil {
		c.resume.mu.Lock()
		defer c.resume.mu.Unlock()
		if c.resume.err != nil {
			return &CloseError{Reason: c.resume.err.Error()}
		}
		return nil
	}
	return c.peerClose.Load()
}

func (c *Conn) Close() (err error) {
	if c.resume != nil {
		return c.resume.close()
	}
	c.closedLocally.Store(true)
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
		go c.releaseListeners()
	})
}

func (c *Conn) releaseListeners() {
	c.listenersOnce.Do(func() {
		c.listenersMu.Lock()
		defer c.listenersMu.Unlock()

		for _, listener := range c.listeners {
			c.ws.Call("removeEventListener", listener.name, listener.fn)
			listener.fn.Release()
		}
		c.listeners = nil
	})
}

func (c *Conn) LocalAddr() net.Addr  { return stubAddr{} }
func (c *Conn) RemoteAddr() net.Addr { return stubAddr{} }
func (c *Conn) SetDeadline(t time.Time) error {
	c.deadlineMu.Lock()
	c.readDeadline = t
	c.writeDeadline = t
	c.deadlineMu.Unlock()
	c.signalDeadlineChanged()
	return nil
}

func (c *Conn) SetReadDeadline(t time.Time) error {
	c.deadlineMu.Lock()
	c.readDeadline = t
	c.deadlineMu.Unlock()
	c.signalDeadlineChanged()
	return nil
}

func (c *Conn) SetWriteDeadline(t time.Time) error {
	c.deadlineMu.Lock()
	c.writeDeadline = t
	c.deadlineMu.Unlock()
	if c.resume != nil {
		c.signalDeadlineChanged()
	}
	return nil
}

func (c *Conn) signalDeadlineChanged() {
	select {
	case c.deadlineChanged <- struct{}{}:
	default:
	}
}

type stubAddr struct{}

func (stubAddr) Network() string { return "websocket" }
func (stubAddr) String() string  { return "websocket" }

type resumeState struct {
	mu               sync.Mutex
	ws               js.Value
	url              string
	host             string
	port             int
	status           func(string, *GraceInfo)
	requestedGraceMs *int64
	maxUnackedBytes  int
	graceInfo        GraceInfo
	unlimited        bool
	sessionID        string
	token            string
	grace            time.Duration
	expires          time.Time
	attached         bool
	detached         bool
	retrying         bool
	closed           bool
	err              error
	clientAck        int64
	clientOffset     int64
	clientSent       int64
	pending          []byte
	serverOffset     int64
	serverAck        int64
	ackSent          int64
	ackTimer         *time.Timer
	lastRelayFrame   time.Time
	received         []byte
	notify           chan struct{}
	done             chan struct{}
	retryReset       chan struct{}
}

// DialResumable explicitly requests protocol v2. Dial remains the v1 path.
func DialResumable(ctx context.Context, wsURL, host, port string, requestedGraceMs *int64, status func(string, *GraceInfo)) (*Conn, error) {
	if requestedGraceMs != nil && (*requestedGraceMs < 1 || *requestedGraceMs > 9007199254740991) {
		return nil, errors.New("invalid requested grace")
	}
	portNum, err := strconv.Atoi(port)
	if err != nil || portNum < 1 || portNum > 65535 {
		return nil, fmt.Errorf("invalid port %q: must be in 1..65535", port)
	}
	r := &resumeState{
		url: wsURL, host: host, port: portNum, status: status, requestedGraceMs: requestedGraceMs,
		notify: make(chan struct{}, 1), done: make(chan struct{}), retryReset: make(chan struct{}, 1),
	}
	c := &Conn{resume: r, deadlineChanged: make(chan struct{}, 1)}
	if err := r.open(ctx, false); err != nil {
		_ = r.close()
		return nil, err
	}
	return c, nil
}

func (r *resumeState) signal() {
	select {
	case r.notify <- struct{}{}:
	default:
	}
}

func (r *resumeState) report(state string, info *GraceInfo) {
	if r.status == nil {
		return
	}
	defer func() { _ = recover() }()
	r.status(state, info)
}

func (r *resumeState) fail(err error) {
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return
	}
	r.closed, r.err = true, err
	if r.ackTimer != nil {
		r.ackTimer.Stop()
	}
	ws := r.ws
	close(r.done)
	r.signal()
	r.mu.Unlock()
	if ws.Truthy() {
		ws.Call("close")
	}
	r.report("expired", nil)
}

func (r *resumeState) open(ctx context.Context, reconnect bool) error {
	ws, err := newWebSocket(r.url)
	if err != nil {
		return err
	}
	ws.Set("binaryType", "arraybuffer")
	result := make(chan error, 1)
	complete := func(err error) {
		select {
		case result <- err:
		default:
		}
	}
	var listeners []eventListener
	add := func(name string, callback func(js.Value, []js.Value) any) {
		fn := js.FuncOf(callback)
		ws.Call("addEventListener", name, fn)
		listeners = append(listeners, eventListener{name: name, fn: fn})
	}
	cleanup := func() {
		for _, listener := range listeners {
			ws.Call("removeEventListener", listener.name, listener.fn)
			listener.fn.Release()
		}
	}
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		ws.Call("close")
		return net.ErrClosed
	}
	r.ws = ws
	r.mu.Unlock()
	add("open", func(js.Value, []js.Value) any {
		r.mu.Lock()
		var frame []any
		if reconnect {
			frame = []any{2, "resume", r.sessionID, r.token, r.clientAck, r.serverAck}
		} else {
			frame = []any{2, "connect", r.host, r.port, r.requestedGraceMs}
		}
		r.mu.Unlock()
		raw, err := json.Marshal(frame)
		if err == nil {
			err = sendV2Text(ws, string(raw))
		}
		if err != nil {
			complete(err)
		}
		return nil
	})
	add("message", func(_ js.Value, args []js.Value) any {
		if len(args) == 0 || args[0].Get("data").Type() != js.TypeString {
			return nil
		}
		r.mu.Lock()
		current := !r.closed && r.ws.Equal(ws)
		if current {
			r.lastRelayFrame = time.Now()
		}
		r.mu.Unlock()
		if !current {
			return nil
		}
		if err := r.message(ws, args[0].Get("data").String(), reconnect, complete); err != nil {
			r.fail(err)
			complete(err)
		}
		return nil
	})
	add("error", func(js.Value, []js.Value) any {
		complete(errWebSocketConnect)
		return nil
	})
	add("close", func(_ js.Value, args []js.Value) any {
		if len(args) > 0 && args[0].Get("reason").String() != "" {
			complete(&CloseError{Code: args[0].Get("code").Int(), Reason: args[0].Get("reason").String()})
		} else {
			complete(errWebSocketConnect)
		}
		r.mu.Lock()
		current := r.ws.Equal(ws)
		wasAttached := r.attached
		if current {
			r.attached = false
			if wasAttached {
				if !r.unlimited {
					r.expires = time.Now().Add(r.grace)
				}
			}
		}
		retry := current && wasAttached && !r.closed && !r.detached && !r.retrying
		if retry {
			r.retrying = true
		}
		r.mu.Unlock()
		if retry {
			r.report("reconnecting", nil)
			go r.retry()
		}
		go cleanup()
		return nil
	})
	select {
	case err = <-result:
	case <-ctx.Done():
		err = ctx.Err()
	}
	if err != nil {
		ws.Call("close")
	}
	return err
}

func sendV2Text(ws js.Value, raw string) (err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("websocket send: %v", recovered)
		}
	}()
	if ws.Get("readyState").Int() != 1 {
		return net.ErrClosed
	}
	ws.Call("send", raw)
	return nil
}

func (r *resumeState) message(ws js.Value, raw string, reconnect bool, complete func(error)) error {
	if len(raw) > 350000 {
		return errors.New("relay frame too large")
	}
	var fields []json.RawMessage
	if err := json.Unmarshal([]byte(raw), &fields); err != nil || len(fields) < 2 {
		return errors.New("invalid relay frame")
	}
	var version int
	var kind string
	if json.Unmarshal(fields[0], &version) != nil || version != 2 || json.Unmarshal(fields[1], &kind) != nil {
		return errors.New("invalid relay version")
	}
	r.mu.Lock()
	reportConnected := false
	defer func() {
		r.mu.Unlock()
		if reportConnected {
			if reconnect {
				r.report("connected", nil)
			} else {
				r.report("connected", &r.graceInfo)
			}
		}
	}()
	switch kind {
	case "ready":
		if reconnect || len(fields) != 7 {
			return errors.New("invalid relay ready frame")
		}
		var limit int64
		var grace, capGrace *int64
		if json.Unmarshal(fields[2], &r.sessionID) != nil || json.Unmarshal(fields[3], &r.token) != nil ||
			json.Unmarshal(fields[4], &limit) != nil || json.Unmarshal(fields[5], &grace) != nil ||
			json.Unmarshal(fields[6], &capGrace) != nil || len(r.sessionID) != 32 || len(r.token) != 64 ||
			limit < 1 || limit > maxResumableBytes ||
			(grace != nil && (*grace < 1 || *grace > 9007199254740991)) ||
			(capGrace != nil && (*capGrace < 1 || *capGrace > 9007199254740991 || grace == nil || *grace > *capGrace)) {
			return errors.New("invalid relay ready frame")
		}
		if _, err := hex.DecodeString(r.sessionID); err != nil {
			return errors.New("invalid relay session ID")
		}
		if _, err := hex.DecodeString(r.token); err != nil {
			return errors.New("invalid relay token")
		}
		r.maxUnackedBytes = int(limit)
		r.graceInfo = GraceInfo{GrantedGraceMs: grace, CapGraceMs: capGrace}
		r.unlimited = grace == nil
		if grace != nil {
			r.grace = time.Duration(min(*grace, int64(9223372036854))) * time.Millisecond
		}
		r.attached = true
		r.lastRelayFrame = time.Now()
		go r.heartbeat(ws)
		reportConnected = true
		complete(nil)
	case "resumed":
		if !reconnect || len(fields) != 5 {
			return errors.New("invalid relay resumed frame")
		}
		var clientAck, serverAck int64
		var newToken string
		if json.Unmarshal(fields[2], &clientAck) != nil || json.Unmarshal(fields[3], &serverAck) != nil ||
			clientAck < r.clientAck || clientAck > r.clientOffset || serverAck != r.serverAck {
			return errors.New("relay offset mismatch")
		}
		if json.Unmarshal(fields[4], &newToken) != nil || len(newToken) != 64 {
			return errors.New("invalid relay resumed frame")
		}
		if _, err := hex.DecodeString(newToken); err != nil {
			return errors.New("invalid relay token")
		}
		r.token = newToken
		r.ackSent = r.serverAck
		r.pending = r.pending[clientAck-r.clientAck:]
		r.clientAck, r.clientSent = clientAck, clientAck
		r.attached = true
		r.lastRelayFrame = time.Now()
		go r.heartbeat(ws)
		if err := r.flush(ws); err != nil {
			return err
		}
		reportConnected = true
		complete(nil)
		r.signal()
	case "data":
		if !r.attached || len(fields) != 5 {
			return errors.New("unexpected relay data")
		}
		var direction, encoded string
		var offset int64
		if json.Unmarshal(fields[2], &direction) != nil || direction != "server" ||
			json.Unmarshal(fields[3], &offset) != nil || json.Unmarshal(fields[4], &encoded) != nil {
			return errors.New("invalid relay data")
		}
		payload, err := base64.StdEncoding.Strict().DecodeString(encoded)
		if err != nil || len(payload) == 0 || len(payload) > r.maxUnackedBytes ||
			offset < r.serverAck || offset > r.serverOffset {
			return errors.New("relay offset mismatch")
		}
		overlap := min(int64(len(payload)), r.serverOffset-offset)
		start := offset - r.serverAck
		if !bytes.Equal(r.received[start:start+overlap], payload[:overlap]) ||
			len(r.received)+len(payload)-int(overlap) > r.maxUnackedBytes {
			return errors.New("relay offset mismatch")
		}
		r.received = append(r.received, payload[overlap:]...)
		r.serverOffset += int64(len(payload)) - overlap
		r.signal()
	case "ack":
		if !r.attached || len(fields) != 4 {
			return errors.New("unexpected relay ack")
		}
		var direction string
		var offset int64
		if json.Unmarshal(fields[2], &direction) != nil || direction != "client" ||
			json.Unmarshal(fields[3], &offset) != nil || offset < r.clientAck || offset > r.clientSent {
			return errors.New("relay offset mismatch")
		}
		r.pending = r.pending[offset-r.clientAck:]
		r.clientAck = offset
		r.signal()
	case "pong":
		if !r.attached || len(fields) != 2 {
			return errors.New("unexpected relay pong")
		}
	case "error":
		var code string
		if len(fields) != 3 || json.Unmarshal(fields[2], &code) != nil {
			return errors.New("invalid relay error")
		}
		switch code {
		case "superseded":
			return errors.New("relay session superseded")
		case "resume_disabled":
			return errors.New("relay resume disabled")
		case "expired":
			return errors.New("relay session expired")
		default:
			return fmt.Errorf("relay session %s", code)
		}
	default:
		return errors.New("unexpected relay frame")
	}
	return nil
}

func (r *resumeState) heartbeat(ws js.Value) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	nextPing := time.Now().Add(20 * time.Second)
	for {
		select {
		case <-r.done:
			return
		case <-ticker.C:
		}
		r.mu.Lock()
		if !r.attached || !r.ws.Equal(ws) || r.closed || r.detached {
			r.mu.Unlock()
			return
		}
		now := time.Now()
		stale := now.Sub(r.lastRelayFrame) >= 90*time.Second
		var err error
		if !stale && !now.Before(nextPing) {
			err = sendV2Text(ws, `[2,"ping"]`)
			nextPing = now.Add(20 * time.Second)
		}
		r.mu.Unlock()
		if stale || err != nil {
			ws.Call("close")
			return
		}
	}
}

func (r *resumeState) sendAck() {
	if !r.attached || r.closed || r.serverAck == r.ackSent {
		return
	}
	raw, _ := json.Marshal([]any{2, "ack", "server", r.serverAck})
	if sendV2Text(r.ws, string(raw)) == nil {
		r.ackSent = r.serverAck
	} else {
		r.ws.Call("close")
	}
}

func (r *resumeState) flush(ws js.Value) error {
	for r.clientSent < r.clientOffset && ws.Get("readyState").Int() == 1 {
		start := r.clientSent - r.clientAck
		n := min(int64(32768), r.clientOffset-r.clientSent)
		raw, err := json.Marshal([]any{2, "data", "client", r.clientSent,
			base64.StdEncoding.EncodeToString(r.pending[start : start+n])})
		if err != nil {
			return err
		}
		if err := sendV2Text(ws, string(raw)); err != nil {
			return err
		}
		r.clientSent += n
	}
	return nil
}

func (r *resumeState) retry() {
	defer func() { r.mu.Lock(); r.retrying = false; r.mu.Unlock() }()
	backoff := 500 * time.Millisecond
	attempted := false
	for {
		r.mu.Lock()
		if r.closed || r.detached {
			r.mu.Unlock()
			return
		}
		remaining := time.Until(r.expires)
		if r.unlimited {
			remaining = 5 * time.Second
		}
		r.mu.Unlock()
		if remaining <= 0 && attempted {
			r.fail(errors.New("relay session expired"))
			return
		}
		attempted = true
		attemptTimeout := 5 * time.Second
		if remaining > 0 && !r.unlimited {
			attemptTimeout = min(remaining, attemptTimeout)
		}
		ctx, cancel := context.WithTimeout(context.Background(), attemptTimeout)
		err := r.open(ctx, true)
		cancel()
		if err == nil {
			return
		}
		r.mu.Lock()
		expired := !r.unlimited && time.Until(r.expires) <= 0
		r.mu.Unlock()
		if expired {
			r.fail(errors.New("relay session expired"))
			return
		}
		timer := time.NewTimer(backoff)
		select {
		case <-r.done:
			timer.Stop()
			return
		case <-r.retryReset:
			backoff = 500 * time.Millisecond
		case <-timer.C:
			backoff = min(backoff*2, 30*time.Second)
		}
		timer.Stop()
	}
}

func (r *resumeState) read(c *Conn, p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	c.readMu.Lock()
	defer c.readMu.Unlock()
	for {
		r.mu.Lock()
		if len(r.received) > 0 {
			n := copy(p, r.received)
			r.received = r.received[n:]
			r.serverAck += int64(n)
			if r.serverAck-r.ackSent >= 32*1024 {
				if r.ackTimer != nil {
					r.ackTimer.Stop()
					r.ackTimer = nil
				}
				r.sendAck()
			} else if r.ackTimer == nil {
				r.ackTimer = time.AfterFunc(50*time.Millisecond, func() {
					r.mu.Lock()
					r.ackTimer = nil
					r.sendAck()
					r.mu.Unlock()
				})
			}
			r.mu.Unlock()
			return n, nil
		}
		if r.closed {
			err := r.err
			r.mu.Unlock()
			return 0, err
		}
		r.mu.Unlock()
		if err := c.waitResume(r.notify, r.done, false); err != nil {
			return 0, err
		}
	}
}

func (r *resumeState) write(c *Conn, p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	written := 0
	for written < len(p) {
		r.mu.Lock()
		if r.closed {
			err := r.err
			r.mu.Unlock()
			return written, err
		}
		room := r.maxUnackedBytes - len(r.pending)
		if room > 0 {
			n := min(room, len(p)-written)
			r.pending = append(r.pending, p[written:written+n]...)
			r.clientOffset += int64(n)
			written += n
			if r.attached {
				if err := r.flush(r.ws); err != nil {
					r.mu.Unlock()
					r.fail(err)
					return written, err
				}
			}
		}
		r.mu.Unlock()
		if written < len(p) {
			if err := c.waitResume(r.notify, r.done, true); err != nil {
				return written, err
			}
		}
	}
	return written, nil
}

func (c *Conn) waitResume(notify, done <-chan struct{}, write bool) error {
	c.deadlineMu.Lock()
	deadline := c.readDeadline
	if write {
		deadline = c.writeDeadline
	}
	c.deadlineMu.Unlock()
	if deadline.IsZero() {
		select {
		case <-notify:
			return nil
		case <-done:
			return nil
		case <-c.deadlineChanged:
			return nil
		}
	}
	remaining := time.Until(deadline)
	if remaining <= 0 {
		return os.ErrDeadlineExceeded
	}
	timer := time.NewTimer(remaining)
	defer timer.Stop()
	select {
	case <-notify:
		return nil
	case <-done:
		return nil
	case <-c.deadlineChanged:
		return nil
	case <-timer.C:
		return os.ErrDeadlineExceeded
	}
}

// Detach leaves the relay's TCP session available for Resume on this page.
func (c *Conn) Detach() {
	if c.resume == nil {
		return
	}
	r := c.resume
	r.mu.Lock()
	r.detached = true
	ws := r.ws
	attached := r.attached
	r.mu.Unlock()
	if attached {
		_ = sendV2Text(ws, `[2,"detach"]`)
		ws.Call("close")
		r.report("reconnecting", nil)
	}
}

// Resume reattaches a deliberately detached transport without reauthenticating SSH.
func (c *Conn) Resume() {
	if c.resume == nil {
		return
	}
	r := c.resume
	r.mu.Lock()
	r.detached = false
	if r.retrying {
		select {
		case r.retryReset <- struct{}{}:
		default:
		}
	}
	start := !r.closed && !r.attached && !r.retrying
	if start {
		r.retrying = true
	}
	r.mu.Unlock()
	if start {
		go r.retry()
	}
}

func (r *resumeState) close() error {
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return nil
	}
	reattach := !r.attached && r.sessionID != ""
	r.detached = true
	r.mu.Unlock()
	var reattachErr error
	if reattach {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		reattachErr = r.open(ctx, true)
		cancel()
	}
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return reattachErr
	}
	r.closed = true
	r.err = net.ErrClosed
	if r.ackTimer != nil {
		r.ackTimer.Stop()
	}
	ws := r.ws
	close(r.done)
	r.signal()
	r.mu.Unlock()
	if ws.Truthy() {
		if ws.Get("readyState").Int() == 1 {
			if err := sendV2Text(ws, `[2,"close"]`); err != nil {
				ws.Call("close")
				return err
			}
		}
		ws.Call("close")
	}
	return reattachErr
}

var _ net.Conn = (*Conn)(nil)
