package writequeue

import (
	"bytes"
	"errors"
	"sync"
	"testing"
	"time"
)

// blockingWriter holds every Write until release is closed, like an SSH
// channel whose remote window is exhausted.
type blockingWriter struct {
	release chan struct{}
	mu      sync.Mutex
	got     bytes.Buffer
	err     error
}

func (w *blockingWriter) Write(p []byte) (int, error) {
	<-w.release
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.err != nil {
		return 0, w.err
	}
	return w.got.Write(p)
}

func (w *blockingWriter) String() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.got.String()
}

func TestEnqueueDoesNotBlockOnAStalledWriter(t *testing.T) {
	w := &blockingWriter{release: make(chan struct{})}
	q := New(w, 1024, func(error) {})
	defer q.Close()

	done := make(chan error, 1)
	go func() { done <- q.Enqueue([]byte("ls\r")) }()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Enqueue: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("Enqueue blocked while the writer was stalled")
	}
	close(w.release)
}

func TestWritesArriveInOrder(t *testing.T) {
	w := &blockingWriter{release: make(chan struct{})}
	q := New(w, 1024, func(error) {})
	defer q.Close()

	for _, chunk := range []string{"a", "b", "c", "d"} {
		if err := q.Enqueue([]byte(chunk)); err != nil {
			t.Fatalf("Enqueue(%q): %v", chunk, err)
		}
	}
	close(w.release)

	deadline := time.Now().Add(time.Second)
	for w.String() != "abcd" {
		if time.Now().After(deadline) {
			t.Fatalf("got %q, want %q", w.String(), "abcd")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestEnqueueCopiesTheCallersBuffer(t *testing.T) {
	w := &blockingWriter{release: make(chan struct{})}
	q := New(w, 1024, func(error) {})
	defer q.Close()

	buf := []byte("one")
	if err := q.Enqueue(buf); err != nil {
		t.Fatal(err)
	}
	copy(buf, "two")
	close(w.release)

	deadline := time.Now().Add(time.Second)
	for w.String() != "one" {
		if time.Now().After(deadline) {
			t.Fatalf("got %q, want %q", w.String(), "one")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestEnqueueRefusesPastTheByteLimit(t *testing.T) {
	w := &blockingWriter{release: make(chan struct{})}
	q := New(w, 8, func(error) {})
	defer func() {
		close(w.release)
		q.Close()
	}()

	if err := q.Enqueue([]byte("12345678")); err != nil {
		t.Fatalf("Enqueue at the limit: %v", err)
	}
	if err := q.Enqueue([]byte("9")); !errors.Is(err, ErrFull) {
		t.Fatalf("Enqueue past the limit = %v, want ErrFull", err)
	}
}

func TestWriteErrorIsReportedAndStopsTheQueue(t *testing.T) {
	w := &blockingWriter{release: make(chan struct{}), err: errors.New("channel closed")}
	reported := make(chan error, 1)
	q := New(w, 1024, func(err error) { reported <- err })
	defer q.Close()

	if err := q.Enqueue([]byte("x")); err != nil {
		t.Fatal(err)
	}
	close(w.release)

	select {
	case err := <-reported:
		if err == nil || err.Error() != "channel closed" {
			t.Fatalf("reported %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("write error was not reported")
	}
	deadline := time.Now().Add(time.Second)
	for !errors.Is(q.Enqueue([]byte("y")), ErrClosed) {
		if time.Now().After(deadline) {
			t.Fatal("Enqueue after a write error did not return ErrClosed")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestEnqueueAfterCloseFails(t *testing.T) {
	q := New(&bytes.Buffer{}, 1024, func(error) {})
	q.Close()
	q.Close() // idempotent

	if err := q.Enqueue([]byte("x")); !errors.Is(err, ErrClosed) {
		t.Fatalf("Enqueue after Close = %v, want ErrClosed", err)
	}
}
