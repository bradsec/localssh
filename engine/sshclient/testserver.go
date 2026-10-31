package sshclient

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"crypto/subtle"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

// TestServer is an in-process SSH server used for hermetic tests. It speaks
// the real SSH protocol over a real TCP listener so tests exercise genuine
// wire behavior without depending on an external sshd binary or container.
type TestServer struct {
	Addr string
	// WithholdRequestReplies makes sessions ignore channel requests, like a
	// server that stalls after authentication.
	WithholdRequestReplies atomic.Bool
	// ExitAfterShell makes a shell report exit status 0 and close at once,
	// like a remote shell whose user typed exit.
	ExitAfterShell atomic.Bool

	listener net.Listener
	config   *ssh.ServerConfig
	sftpRoot string

	keysMu         sync.Mutex
	authorizedKeys [][]byte
}

// AuthorizeKey lets the server's username log in with the private key that
// matches pub, in addition to the password.
func (s *TestServer) AuthorizeKey(pub ssh.PublicKey) {
	s.keysMu.Lock()
	defer s.keysMu.Unlock()
	s.authorizedKeys = append(s.authorizedKeys, pub.Marshal())
}

func (s *TestServer) keyAuthorized(pub ssh.PublicKey) bool {
	s.keysMu.Lock()
	defer s.keysMu.Unlock()
	for _, key := range s.authorizedKeys {
		if bytes.Equal(key, pub.Marshal()) {
			return true
		}
	}
	return false
}

// NewTestServer starts listening on 127.0.0.1:0 and accepts only the given
// username/password pair, plus any keys later passed to AuthorizeKey.
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
	s := &TestServer{config: config}
	config.PublicKeyCallback = func(conn ssh.ConnMetadata, pub ssh.PublicKey) (*ssh.Permissions, error) {
		if conn.User() == username && s.keyAuthorized(pub) {
			return nil, nil
		}
		return nil, fmt.Errorf("public key not authorized")
	}
	config.AddHostKey(signer)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("listen: %w", err)
	}

	s.Addr = listener.Addr().String()
	s.listener = listener
	go s.serve()
	return s, nil
}

func (s *TestServer) Close() error { return s.listener.Close() }

// EnableSFTP serves a test-only file tree rooted at root on each connection.
// Call before connecting clients.
func (s *TestServer) EnableSFTP(root string) { s.sftpRoot = root }

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
		if s.WithholdRequestReplies.Load() {
			go func() {
				for range requests {
				}
			}()
			continue
		}
		go handleSession(channel, requests, s.ExitAfterShell.Load(), s.sftpRoot)
	}
}

// handleSession implements just enough of the session channel protocol to
// prove PTY I/O round-trips correctly: pty-req, shell, window-change. Once a
// shell is requested it echoes whatever it reads back to the client.
func handleSession(channel ssh.Channel, requests <-chan *ssh.Request, exitAfterShell bool, sftpRoot string) {
	defer channel.Close()
	for req := range requests {
		switch req.Type {
		case "pty-req", "window-change":
			req.Reply(true, nil)
		case "shell":
			req.Reply(true, nil)
			if exitAfterShell {
				channel.SendRequest("exit-status", false, ssh.Marshal(struct{ Status uint32 }{0}))
				return
			}
			go echoLoop(channel)
		case "subsystem":
			if sftpRoot == "" || string(req.Payload) != "\x00\x00\x00\x04sftp" {
				req.Reply(false, nil)
				continue
			}
			req.Reply(true, nil)
			h := &testSFTPFiles{root: sftpRoot}
			_ = sftp.NewRequestServer(channel, sftp.Handlers{FileGet: h, FilePut: h, FileList: h, FileCmd: h}).Serve()
			return
		default:
			req.Reply(false, nil)
		}
	}
}

type testSFTPFiles struct{ root string }

func (h *testSFTPFiles) path(name string) (string, error) {
	path := filepath.Join(h.root, strings.TrimPrefix(filepath.Clean("/"+name), "/"))
	parent := path
	if _, err := os.Lstat(path); os.IsNotExist(err) {
		parent = filepath.Dir(path)
	}
	resolved, err := filepath.EvalSymlinks(parent)
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(h.root, resolved)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", os.ErrPermission
	}
	return path, nil
}

func (h *testSFTPFiles) Fileread(r *sftp.Request) (io.ReaderAt, error) {
	path, err := h.path(r.Filepath)
	if err != nil {
		return nil, err
	}
	return os.Open(path)
}

func (h *testSFTPFiles) Filewrite(r *sftp.Request) (io.WriterAt, error) {
	path, err := h.path(r.Filepath)
	if err != nil {
		return nil, err
	}
	flags := os.O_WRONLY
	p := r.Pflags()
	if p.Creat {
		flags |= os.O_CREATE
	}
	if p.Trunc {
		flags |= os.O_TRUNC
	}
	if p.Excl {
		flags |= os.O_EXCL
	}
	return os.OpenFile(path, flags, 0600)
}

type testFileList []os.FileInfo

func (l testFileList) ListAt(dst []os.FileInfo, offset int64) (int, error) {
	if offset >= int64(len(l)) {
		return 0, io.EOF
	}
	return copy(dst, l[offset:]), nil
}

func (h *testSFTPFiles) Filelist(r *sftp.Request) (sftp.ListerAt, error) {
	path, err := h.path(r.Filepath)
	if err != nil {
		return nil, err
	}
	if r.Method == "List" {
		entries, err := os.ReadDir(path)
		if err != nil {
			return nil, err
		}
		list := make(testFileList, 0, len(entries))
		for _, entry := range entries {
			info, err := entry.Info()
			if err != nil {
				return nil, err
			}
			list = append(list, info)
		}
		return list, nil
	}
	stat := os.Stat
	if r.Method == "Lstat" {
		stat = os.Lstat
	}
	info, err := stat(path)
	if err != nil {
		return nil, err
	}
	return testFileList{info}, nil
}

func (h *testSFTPFiles) Filecmd(r *sftp.Request) error {
	name, err := h.path(r.Filepath)
	if err != nil {
		return err
	}
	switch r.Method {
	case "Remove":
		return os.Remove(name)
	case "Setstat":
		if r.AttrFlags().Permissions {
			return os.Chmod(name, r.Attributes().FileMode()&(os.ModePerm|os.ModeSetuid|os.ModeSetgid|os.ModeSticky))
		}
		return nil
	case "Rename":
		target, err := h.path(r.Target)
		if err != nil {
			return err
		}
		if _, err := os.Lstat(target); err == nil {
			// OpenSSH sftp-server answers this case with a generic
			// SSH_FX_FAILURE, not a "file exists" status; match it.
			return errors.New("failure")
		} else if !os.IsNotExist(err) {
			return err
		}
		return os.Rename(name, target)
	default:
		return os.ErrPermission
	}
}

func (h *testSFTPFiles) PosixRename(r *sftp.Request) error {
	name, err := h.path(r.Filepath)
	if err != nil {
		return err
	}
	target, err := h.path(r.Target)
	if err != nil {
		return err
	}
	return os.Rename(name, target)
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
