package sshclient

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/subtle"
	"fmt"
	"net"

	"golang.org/x/crypto/ssh"
)

// TestServer is an in-process SSH server used for hermetic tests. It speaks
// the real SSH protocol over a real TCP listener so tests exercise genuine
// wire behavior without depending on an external sshd binary or container.
type TestServer struct {
	Addr string

	listener net.Listener
	config   *ssh.ServerConfig
}

// NewTestServer starts listening on 127.0.0.1:0 and accepts only the given
// username/password pair.
func NewTestServer(username, password string) (*TestServer, error) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, fmt.Errorf("generate host key: %w", err)
	}
	signer, err := ssh.NewSignerFromKey(key)
	if err != nil {
		return nil, fmt.Errorf("signer: %w", err)
	}

	config := &ssh.ServerConfig{
		PasswordCallback: func(conn ssh.ConnMetadata, pass []byte) (*ssh.Permissions, error) {
			userOK := subtle.ConstantTimeCompare([]byte(conn.User()), []byte(username))
			passOK := subtle.ConstantTimeCompare(pass, []byte(password))
			if userOK&passOK == 1 {
				return nil, nil
			}
			return nil, fmt.Errorf("invalid credentials")
		},
	}
	config.AddHostKey(signer)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("listen: %w", err)
	}

	s := &TestServer{Addr: listener.Addr().String(), listener: listener, config: config}
	go s.serve()
	return s, nil
}

func (s *TestServer) Close() error { return s.listener.Close() }

func (s *TestServer) serve() {
	for {
		netConn, err := s.listener.Accept()
		if err != nil {
			return // listener closed
		}
		go s.handleConn(netConn)
	}
}

func (s *TestServer) handleConn(netConn net.Conn) {
	sshConn, chans, reqs, err := ssh.NewServerConn(netConn, s.config)
	if err != nil {
		return
	}
	defer sshConn.Close()
	go ssh.DiscardRequests(reqs)

	for newChan := range chans {
		if newChan.ChannelType() != "session" {
			newChan.Reject(ssh.UnknownChannelType, "unsupported channel type")
			continue
		}
		channel, requests, err := newChan.Accept()
		if err != nil {
			continue
		}
		go handleSession(channel, requests)
	}
}

// handleSession implements just enough of the session channel protocol to
// prove PTY I/O round-trips correctly: pty-req, shell, window-change. Once a
// shell is requested it echoes whatever it reads back to the client.
func handleSession(channel ssh.Channel, requests <-chan *ssh.Request) {
	defer channel.Close()
	for req := range requests {
		switch req.Type {
		case "pty-req", "window-change":
			req.Reply(true, nil)
		case "shell":
			req.Reply(true, nil)
			go echoLoop(channel)
		default:
			req.Reply(false, nil)
		}
	}
}

func echoLoop(channel ssh.Channel) {
	buf := make([]byte, 4096)
	for {
		n, err := channel.Read(buf)
		if n > 0 {
			channel.Write(buf[:n])
		}
		if err != nil {
			return
		}
	}
}
