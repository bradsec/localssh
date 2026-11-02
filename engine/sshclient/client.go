package sshclient

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/crypto/ssh"
)

const (
	maxTerminalDimension = 65535
	keepaliveInterval    = 15 * time.Second
	keepaliveMaxMisses   = 3
)

// HostKeyFingerprint is the SHA256 fingerprint of a host key, in OpenSSH's
// "SHA256:base64..." presentation form.
type HostKeyFingerprint string

// VerifyHostKeyFunc is called once per connection with the offered host
// key's fingerprint. Return nil to proceed, or an error to abort the
// connection (e.g. the caller rejected an unknown or changed key).
type VerifyHostKeyFunc func(hostPort string, fp HostKeyFingerprint) error

// Session wraps an established SSH connection plus a single PTY shell
// channel opened on it. The underlying *ssh.Client is retained and exposed
// via Client() so later work (SFTP, port forwarding) can open additional
// channels on the same authenticated connection instead of reconnecting.
type Session struct {
	conn    ssh.Conn
	client  *ssh.Client
	channel ssh.Channel
	// exited records an exit-status or exit-signal from the server, which is
	// how a shell that ended on its own differs from a dropped connection.
	exited *atomic.Bool
	// requestsDone closes once every channel request has been read.
	requestsDone      chan struct{}
	keepaliveStop     chan struct{}
	keepaliveStopOnce sync.Once
	keepalivePaused   atomic.Bool
	keepaliveChanged  chan struct{}
}

// Client returns the underlying *ssh.Client, for opening additional
// channels on this same connection (e.g. github.com/pkg/sftp.NewClient,
// or direct-tcpip/forwarded-tcpip channels for port forwarding).
func (s *Session) Client() *ssh.Client { return s.client }

// Connect performs the SSH handshake and password authentication over an
// already-established net.Conn. The caller is responsible for obtaining
// that Conn, whether via a real TCP dial (tests, native builds) or a
// relay-backed transport (wsconn, in the WASM build).
func Connect(ctx context.Context, conn net.Conn, hostPort, username, password string, verifyHostKey VerifyHostKeyFunc) (*Session, error) {
	return connect(ctx, conn, hostPort, username, ssh.Password(password), verifyHostKey)
}

// ConnectWithKey is Connect with public-key authentication by signer. A
// server that refuses the key fails with an error wrapping ErrKeyRejected.
func ConnectWithKey(ctx context.Context, conn net.Conn, hostPort, username string, signer ssh.Signer, verifyHostKey VerifyHostKeyFunc) (*Session, error) {
	session, err := connect(ctx, conn, hostPort, username, ssh.PublicKeys(signer), verifyHostKey)
	// x/crypto/ssh reports exhausted auth methods only as this text.
	if err != nil && strings.Contains(err.Error(), "unable to authenticate") {
		return nil, fmt.Errorf("%w: %w", ErrKeyRejected, err)
	}
	return session, err
}

func connect(ctx context.Context, conn net.Conn, hostPort, username string, auth ssh.AuthMethod, verifyHostKey VerifyHostKeyFunc) (*Session, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if verifyHostKey == nil {
		return nil, errors.New("verify host key callback is required")
	}

	config := &ssh.ClientConfig{
		User: username,
		Auth: []ssh.AuthMethod{auth},
		HostKeyCallback: func(hostname string, remote net.Addr, key ssh.PublicKey) error {
			return verifyHostKey(hostPort, HostKeyFingerprint(ssh.FingerprintSHA256(key)))
		},
	}

	// canceled becomes true exactly once: either the watcher goroutine wins
	// it on ctx cancellation (and closes conn), or Connect's success path
	// wins it first (and the watcher then does nothing). This CAS is what
	// prevents a cancellation racing with a just-completed handshake from
	// silently closing a Session that has already been returned to the
	// caller as successful.
	var canceled atomic.Bool
	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-ctx.Done():
			if canceled.CompareAndSwap(false, true) {
				conn.Close()
			}
		case <-done:
		}
	}()

	sshConn, chans, reqs, err := ssh.NewClientConn(conn, hostPort, config)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("ssh handshake: %w", err)
	}
	client := ssh.NewClient(sshConn, chans, reqs)

	channel, requests, err := client.Conn.OpenChannel("session", nil)
	if err != nil {
		client.Close()
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("open session channel: %w", err)
	}
	exited := new(atomic.Bool)
	requestsDone := make(chan struct{})
	go func() {
		defer close(requestsDone)
		for req := range requests {
			if req.Type == "exit-status" || req.Type == "exit-signal" {
				exited.Store(true)
			}
			if req.WantReply {
				_ = req.Reply(false, nil)
			}
		}
	}()

	if !canceled.CompareAndSwap(false, true) {
		// The watcher already won: ctx was canceled at essentially the same
		// moment the handshake completed, and it has closed (or is closing)
		// conn. Treat this exactly like any other cancellation rather than
		// handing back a Session whose connection may already be dead.
		client.Close()
		return nil, ctx.Err()
	}

	session := &Session{
		conn:             sshConn,
		client:           client,
		channel:          channel,
		exited:           exited,
		requestsDone:     requestsDone,
		keepaliveStop:    make(chan struct{}),
		keepaliveChanged: make(chan struct{}, 1),
	}
	go runKeepalives(session, keepaliveInterval, keepaliveMaxMisses)
	return session, nil
}

// PauseKeepalives stops probes while the transport is detached.
func (s *Session) PauseKeepalives() {
	if !s.keepalivePaused.Swap(true) {
		select {
		case s.keepaliveChanged <- struct{}{}:
		default:
		}
	}
}

// ResumeKeepalives restarts probes at their normal interval.
func (s *Session) ResumeKeepalives() {
	if s.keepalivePaused.Swap(false) {
		select {
		case s.keepaliveChanged <- struct{}{}:
		default:
		}
	}
}

func runKeepalives(s *Session, interval time.Duration, maxMisses int) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	var reply <-chan error
	misses := 0
	for {
		select {
		case <-s.keepaliveStop:
			return
		case <-s.keepaliveChanged:
			misses = 0
			if s.keepalivePaused.Load() {
				ticker.Stop()
			} else {
				ticker.Reset(interval)
			}
		case err := <-reply:
			if err != nil {
				if !s.keepalivePaused.Load() {
					_ = s.conn.Close()
					return
				}
			}
			reply = nil
			misses = 0
		case <-ticker.C:
			if s.keepalivePaused.Load() {
				continue
			}
			if reply != nil {
				misses++
				if misses >= maxMisses {
					_ = s.conn.Close()
					return
				}
				continue
			}
			result := make(chan error, 1)
			reply = result
			go func() {
				_, _, err := s.conn.SendRequest("keepalive@openssh.com", true, nil)
				result <- err
			}()
		}
	}
}

// RequestPTY asks the remote to allocate a pseudo-terminal of the given
// size and requests a shell on it. Call once, before Write/Read.
//
// Both requests wait for the server's reply, so ctx bounds them: when it ends
// first, the connection is closed and ctx's error is returned.
func (s *Session) RequestPTY(ctx context.Context, cols, rows int) error {
	if err := validateTerminalSize(cols, rows); err != nil {
		return err
	}
	stop := context.AfterFunc(ctx, func() { _ = s.conn.Close() })
	err := s.requestPTY(cols, rows)
	if !stop() {
		return ctx.Err()
	}
	return err
}

func (s *Session) requestPTY(cols, rows int) error {
	payload := ssh.Marshal(struct {
		Term                    string
		Width, Height           uint32
		PixelWidth, PixelHeight uint32
		Modes                   string
	}{
		Term:        "xterm-256color",
		Width:       uint32(cols),
		Height:      uint32(rows),
		PixelWidth:  0,
		PixelHeight: 0,
		Modes:       "",
	})

	ok, err := s.channel.SendRequest("pty-req", true, payload)
	if err != nil {
		return fmt.Errorf("pty-req: %w", err)
	}
	if !ok {
		return fmt.Errorf("pty-req rejected")
	}

	ok, err = s.channel.SendRequest("shell", true, nil)
	if err != nil {
		return fmt.Errorf("shell: %w", err)
	}
	if !ok {
		return fmt.Errorf("shell rejected")
	}
	return nil
}

// Resize sends a window-change request for a new terminal size.
func (s *Session) Resize(cols, rows int) error {
	if err := validateTerminalSize(cols, rows); err != nil {
		return err
	}
	payload := ssh.Marshal(struct {
		Width, Height           uint32
		PixelWidth, PixelHeight uint32
	}{
		Width:       uint32(cols),
		Height:      uint32(rows),
		PixelWidth:  0,
		PixelHeight: 0,
	})
	_, err := s.channel.SendRequest("window-change", false, payload)
	return err
}

func validateTerminalSize(cols, rows int) error {
	if cols < 1 || cols > maxTerminalDimension || rows < 1 || rows > maxTerminalDimension {
		return fmt.Errorf(
			"terminal size must be within 1..%d columns and rows",
			maxTerminalDimension,
		)
	}
	return nil
}

// Write sends bytes to the remote shell's stdin.
func (s *Session) Write(p []byte) (int, error) { return s.channel.Write(p) }

// Read reads the remote PTY output. RequestPTY must precede Read: a PTY shell
// attaches stdout and stderr to the same terminal, so both arrive as normal
// channel data. Separate SSH extended-data stderr is intentionally not read.
// Servers that send it even after accepting a PTY are unsupported and can
// stall when unread extended data exhausts the shared channel window.
func (s *Session) Read(p []byte) (int, error) { return s.channel.Read(p) }

// ExitReported reports whether the server announced the end of the shell with
// an exit status or signal (RFC 4254 section 6.10) before the channel closed.
// Call it after Close: it waits until every request has been read, which only
// a closed channel or connection guarantees.
func (s *Session) ExitReported() bool {
	<-s.requestsDone
	return s.exited.Load()
}

func (s *Session) Close() error {
	s.keepaliveStopOnce.Do(func() { close(s.keepaliveStop) })
	return errors.Join(s.conn.Close(), s.channel.Close())
}
