// Package writequeue moves writes off the caller's goroutine while keeping
// their order.
//
// In the WebAssembly build, input arrives in a js.FuncOf callback, which runs
// with the browser's event loop paused. An SSH channel write blocks when the
// remote window is exhausted, and the window adjustment that would unblock it
// arrives as a WebSocket message, which needs that same event loop. Writing
// from the callback therefore deadlocks the page; queueing does not.
package writequeue

import (
	"bytes"
	"errors"
	"io"
	"sync"
)

var (
	// ErrFull is returned when accepting a write would exceed the byte limit.
	ErrFull = errors.New("write queue full")
	// ErrClosed is returned once the queue has been closed or a write failed.
	ErrClosed = errors.New("write queue closed")
)

// Queue writes enqueued chunks to w, in order, on its own goroutine.
type Queue struct {
	w        io.Writer
	maxBytes int
	onError  func(error)

	mu     sync.Mutex
	chunks [][]byte
	// queued counts bytes accepted but not yet fully written, including the
	// chunk being written, so a stalled writer holds the limit.
	queued int
	closed bool

	wake      chan struct{}
	done      chan struct{}
	closeOnce sync.Once
}

// New starts a queue that holds at most maxBytes of unwritten data. onError
// is called once, from the queue's goroutine, if a write fails; the queue is
// closed before it is called.
func New(w io.Writer, maxBytes int, onError func(error)) *Queue {
	q := &Queue{
		w:        w,
		maxBytes: maxBytes,
		onError:  onError,
		wake:     make(chan struct{}, 1),
		done:     make(chan struct{}),
	}
	go q.run()
	return q
}

// Enqueue copies p and schedules it to be written. It never blocks on the
// writer.
func (q *Queue) Enqueue(p []byte) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.closed {
		return ErrClosed
	}
	if len(p) > q.maxBytes-q.queued {
		return ErrFull
	}
	q.chunks = append(q.chunks, bytes.Clone(p))
	q.queued += len(p)
	select {
	case q.wake <- struct{}{}:
	default:
	}
	return nil
}

// Close discards unwritten data and stops the queue. It does not interrupt a
// write already in progress; closing the underlying writer does that.
func (q *Queue) Close() {
	q.closeOnce.Do(func() {
		q.mu.Lock()
		q.closed = true
		q.chunks = nil
		q.mu.Unlock()
		close(q.done)
	})
}

func (q *Queue) run() {
	for {
		select {
		case <-q.wake:
		case <-q.done:
			return
		}
		for {
			chunk, ok := q.next()
			if !ok {
				break
			}
			if _, err := q.w.Write(chunk); err != nil {
				q.Close()
				q.onError(err)
				return
			}
			q.mu.Lock()
			q.queued -= len(chunk)
			q.mu.Unlock()
		}
	}
}

func (q *Queue) next() ([]byte, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.closed || len(q.chunks) == 0 {
		return nil, false
	}
	chunk := q.chunks[0]
	q.chunks[0] = nil
	q.chunks = q.chunks[1:]
	return chunk, true
}
