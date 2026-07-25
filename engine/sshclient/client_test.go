package sshclient

import (
	"context"
	"errors"
	"io"
	"net"
	"testing"
	"time"
)

func TestConnectAuthAndEcho(t *testing.T) {
	server, err := NewTestServer("tester", "s3cret")
	if err != nil {
		t.Fatalf("start test server: %v", err)
	}
	defer server.Close()

	conn, err := net.DialTimeout("tcp", server.Addr, 2*time.Second)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}

	var gotFingerprint HostKeyFingerprint
	verify := func(hostPort string, fp HostKeyFingerprint) error {
		gotFingerprint = fp
		return nil // accept on first use
	}

	session, err := Connect(context.Background(), conn, server.Addr, "tester", "s3cret", verify)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer session.Close()

	if gotFingerprint == "" {
		t.Fatal("expected a host key fingerprint to be reported")
	}

	if err := session.RequestPTY(80, 24); err != nil {
		t.Fatalf("request pty: %v", err)
	}

	if _, err := session.Write([]byte("hello\n")); err != nil {
		t.Fatalf("write: %v", err)
	}

	buf := make([]byte, len("hello\n"))
	if _, err := io.ReadFull(session, buf); err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(buf) != "hello\n" {
		t.Fatalf("got %q, want %q", buf, "hello\n")
	}
}

func TestConnectRejectsBadPassword(t *testing.T) {
	server, err := NewTestServer("tester", "s3cret")
	if err != nil {
		t.Fatalf("start test server: %v", err)
	}
	defer server.Close()

	conn, err := net.DialTimeout("tcp", server.Addr, 2*time.Second)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}

	_, err = Connect(context.Background(), conn, server.Addr, "tester", "wrong", func(string, HostKeyFingerprint) error { return nil })
	if err == nil {
		t.Fatal("expected auth failure, got nil error")
	}
}

func TestConnectRejectsHostKey(t *testing.T) {
	server, err := NewTestServer("tester", "s3cret")
	if err != nil {
		t.Fatalf("start test server: %v", err)
	}
	defer server.Close()

	conn, err := net.DialTimeout("tcp", server.Addr, 2*time.Second)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}

	sentinel := errors.New("host key rejected by test")
	verify := func(hostPort string, fp HostKeyFingerprint) error {
		return sentinel
	}

	session, err := Connect(context.Background(), conn, server.Addr, "tester", "s3cret", verify)
	if err == nil {
		t.Fatal("expected error from rejected host key, got nil")
	}
	if session != nil {
		t.Fatalf("expected nil session on host key rejection, got %+v", session)
	}
	if !errors.Is(err, sentinel) {
		t.Fatalf("expected error to wrap sentinel host key error, got %v", err)
	}
}

func TestConnectCanceledContext(t *testing.T) {
	server, err := NewTestServer("tester", "s3cret")
	if err != nil {
		t.Fatalf("start test server: %v", err)
	}
	defer server.Close()

	conn, err := net.DialTimeout("tcp", server.Addr, 2*time.Second)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	session, err := Connect(ctx, conn, server.Addr, "tester", "s3cret", func(string, HostKeyFingerprint) error { return nil })
	if err == nil {
		t.Fatal("expected error from canceled context, got nil")
	}
	if session != nil {
		t.Fatalf("expected nil session on canceled context, got %+v", session)
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled, got %v", err)
	}
}

// A relay that accepts the socket but never speaks SSH must not hang Connect
// forever. Before the connect deadline existed, this blocked indefinitely and
// left the UI stuck on "Connecting" with no recovery short of a page reload.
func TestConnectTimesOutOnSilentPeer(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()

	accepted := make(chan net.Conn, 1)
	go func() {
		silent, acceptErr := listener.Accept()
		if acceptErr != nil {
			return
		}
		accepted <- silent // hold the connection open and send nothing
	}()

	conn, err := net.DialTimeout("tcp", listener.Addr().String(), 2*time.Second)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer cancel()

	done := make(chan error, 1)
	go func() {
		_, connectErr := Connect(ctx, conn, listener.Addr().String(), "tester", "s3cret",
			func(string, HostKeyFingerprint) error { return nil })
		done <- connectErr
	}()

	select {
	case err := <-done:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("expected context.DeadlineExceeded, got %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Connect did not return after the context deadline elapsed")
	}

	select {
	case silent := <-accepted:
		silent.Close()
	default:
	}
}
