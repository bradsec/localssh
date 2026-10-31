package sshclient

import (
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

type keepaliveConn struct {
	ssh.Conn
	reply  chan struct{}
	sent   chan struct{}
	closed chan struct{}
	calls  atomic.Int32
}

func (c *keepaliveConn) SendRequest(name string, wantReply bool, payload []byte) (bool, []byte, error) {
	if name != "keepalive@openssh.com" || !wantReply || len(payload) != 0 {
		panic("unexpected keepalive request")
	}
	c.calls.Add(1)
	if c.sent != nil {
		c.sent <- struct{}{}
	}
	select {
	case <-c.reply:
		return false, nil, nil // An unsupported request still proves the peer replied.
	case <-c.closed:
		return false, nil, ssh.ErrNoAuth
	}
}

func (c *keepaliveConn) Close() error {
	select {
	case <-c.closed:
	default:
		close(c.closed)
	}
	return nil
}

func TestKeepalivesCloseAfterMissedReplies(t *testing.T) {
	conn := &keepaliveConn{reply: make(chan struct{}), closed: make(chan struct{})}
	stop := make(chan struct{})
	defer close(stop)
	go runKeepalives(conn, stop, 10*time.Millisecond, 3)

	select {
	case <-conn.closed:
		if got := conn.calls.Load(); got != 1 {
			t.Fatalf("sent %d overlapping requests, want 1", got)
		}
	case <-time.After(time.Second):
		t.Fatal("unanswered keepalive did not close the connection")
	}
}

func TestKeepalivesAcceptFailureReply(t *testing.T) {
	conn := &keepaliveConn{reply: make(chan struct{}, 10), sent: make(chan struct{}, 10), closed: make(chan struct{})}
	stop := make(chan struct{})
	done := make(chan struct{})
	for range 10 {
		conn.reply <- struct{}{}
	}
	go func() {
		runKeepalives(conn, stop, 10*time.Millisecond, 3)
		close(done)
	}()
	for range 3 {
		select {
		case <-conn.sent:
		case <-time.After(time.Second):
			t.Fatal("keepalives stopped despite replies")
		}
	}
	close(stop)
	<-done
	select {
	case <-conn.closed:
		t.Fatal("connection closed despite replies")
	default:
	}
}
