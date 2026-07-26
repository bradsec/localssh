package sshclient

import (
	"context"
	"errors"
	"fmt"
	"net"
	"sync/atomic"

	"golang.org/x/crypto/ssh"
)

const maxTerminalDimension = 65535

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
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	config := &ssh.ClientConfig{
		User: username,
		Auth: []ssh.AuthMethod{ssh.Password(password)},
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
	go ssh.DiscardRequests(requests)

	if !canceled.CompareAndSwap(false, true) {
		// The watcher already won: ctx was canceled at essentially the same
		// moment the handshake completed, and it has closed (or is closing)
		// conn. Treat this exactly like any other cancellation rather than
		// handing back a Session whose connection may already be dead.
		client.Close()
		return nil, ctx.Err()
	}

	return &Session{conn: sshConn, client: client, channel: channel}, nil
}

// RequestPTY asks the remote to allocate a pseudo-terminal of the given
// size and requests a shell on it. Call once, before Write/Read.
func (s *Session) RequestPTY(cols, rows int) error {
	if err := validateTerminalSize(cols, rows); err != nil {
		return err
	}
	payload := ssh.Marshal(struct {
		Term                    string
		Width, Height           uint32
		PixelWidth, PixelHeight uint32
		Modes                   string
	}{"xterm-256color", uint32(cols), uint32(rows), 0, 0, ""})

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
	}{uint32(cols), uint32(rows), 0, 0})
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

// Read reads bytes from the remote shell's stdout/stderr.
func (s *Session) Read(p []byte) (int, error) { return s.channel.Read(p) }

func (s *Session) Close() error {
	return errors.Join(s.channel.Close(), s.conn.Close())
}
