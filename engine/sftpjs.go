//go:build js && wasm

package main

import (
	"context"
	"errors"
	"io"
	"math"
	"sync"
	"syscall/js"
	"time"

	"github.com/pkg/sftp"

	"engine/remotefiles"
)

// cleanupTimeout bounds how long closing the panel or the session waits for
// a cancelled upload to remove its temporary file.
const cleanupTimeout = 10 * time.Second

var errFilesClosed = errors.New("SFTP closed")

// sftpBridge adapts package remotefiles to the JavaScript file panel.
type sftpBridge struct {
	client *sftp.Client
	mu     sync.Mutex
	active *fileTransfer
	closed bool
	funcs  []js.Func

	closeOnce sync.Once
	closeErr  error
}

type fileTransfer struct {
	cancel context.CancelFunc
	done   chan struct{}
}

func (f *sftpBridge) start() (context.Context, *fileTransfer, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return nil, nil, errFilesClosed
	}
	if f.active != nil {
		return nil, nil, errors.New("transfer already in progress")
	}
	ctx, cancel := context.WithCancel(context.Background())
	t := &fileTransfer{cancel: cancel, done: make(chan struct{})}
	f.active = t
	return ctx, t, nil
}

func (f *sftpBridge) finish(t *fileTransfer) {
	f.mu.Lock()
	defer f.mu.Unlock()
	t.cancel()
	close(t.done)
	if f.active == t {
		f.active = nil
	}
}

// busy reports whether a transfer is running. Closing then has to wait for
// it, which needs the JavaScript event loop, so callers close off the
// callback goroutine.
func (f *sftpBridge) busy() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.active != nil
}

// close cancels any transfer, waits up to cleanupTimeout for it to remove its
// temporary file while the client is still open, then closes the client.
// Every caller returns only after that has happened.
func (f *sftpBridge) close() error {
	f.closeOnce.Do(func() {
		f.mu.Lock()
		f.closed = true
		active := f.active
		f.mu.Unlock()
		if active != nil {
			active.cancel()
			select {
			case <-active.done:
			case <-time.After(cleanupTimeout):
			}
		}
		f.closeErr = f.client.Close()
		// A call through a released func returns undefined instead of a
		// Promise; the page treats that as closed (see guardSftp in engine.ts).
		for _, fn := range f.funcs {
			fn.Release()
		}
	})
	return f.closeErr
}

func promise(work func() (any, error)) js.Value {
	executor := js.FuncOf(func(_ js.Value, args []js.Value) any {
		resolve, reject := args[0], args[1]
		go func() {
			value, err := work()
			if err != nil {
				reject.Invoke(err.Error())
			} else {
				resolve.Invoke(value)
			}
		}()
		return nil
	})
	result := js.Global().Get("Promise").New(executor)
	executor.Release()
	return result
}

// awaitPromise waits for value, which may be a Promise or a plain value.
func awaitPromise(value js.Value) (js.Value, error) {
	type result struct {
		value js.Value
		err   error
	}
	ready := make(chan result, 1)
	ok := js.FuncOf(func(_ js.Value, args []js.Value) any { ready <- result{value: args[0]}; return nil })
	bad := js.FuncOf(func(_ js.Value, args []js.Value) any {
		ready <- result{err: errors.New(js.Global().Get("String").Invoke(args[0]).String())}
		return nil
	})
	js.Global().Get("Promise").Call("resolve", value).Call("then", ok, bad)
	r := <-ready
	ok.Release()
	bad.Release()
	return r.value, r.err
}

func (b *sessionBridge) openFiles() js.Value {
	return promise(func() (any, error) {
		client, err := sftp.NewClient(b.session.Client(), remotefiles.ClientOptions()...)
		if err != nil {
			return nil, err
		}
		files := &sftpBridge{client: client}
		value := files.value()
		b.filesMu.Lock()
		if b.closed {
			b.filesMu.Unlock()
			_ = files.close()
			return nil, errors.New("connection closed")
		}
		previous := b.files
		b.files = files
		b.filesMu.Unlock()
		if previous != nil {
			_ = previous.close()
		}
		return value, nil
	})
}

func (f *sftpBridge) value() js.Value {
	list := js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) != 1 || args[0].Type() != js.TypeString {
			return promise(func() (any, error) { return nil, errors.New("path must be a string") })
		}
		name := args[0].String()
		return promise(func() (any, error) {
			f.mu.Lock()
			closed := f.closed
			f.mu.Unlock()
			if closed {
				return nil, errFilesClosed
			}
			resolved, entries, truncated, err := remotefiles.List(f.client, name, time.Now())
			if err != nil {
				return nil, err
			}
			items := make([]any, 0, len(entries))
			for _, entry := range entries {
				items = append(items, map[string]any{"name": entry.Name, "kind": string(entry.Kind), "isLink": entry.IsLink, "size": float64(entry.Size), "mtime": float64(entry.ModTime), "mode": entry.Mode})
			}
			return map[string]any{"path": resolved, "entries": items, "truncated": truncated}, nil
		})
	})
	upload := js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) != 4 || args[0].Type() != js.TypeString || !args[1].InstanceOf(js.Global().Get("File")) || args[2].Type() != js.TypeBoolean || args[3].Type() != js.TypeFunction {
			return promise(func() (any, error) { return nil, errors.New("invalid upload arguments") })
		}
		name, local, overwrite, progress := args[0].String(), args[1], args[2].Bool(), args[3]
		return promise(func() (any, error) { return nil, f.upload(name, local, overwrite, progress) })
	})
	download := js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) < 3 || len(args) > 4 || args[0].Type() != js.TypeString || args[1].Type() != js.TypeFunction || args[2].Type() != js.TypeFunction {
			return promise(func() (any, error) { return nil, errors.New("invalid download arguments") })
		}
		name, chunk, progress := args[0].String(), args[1], args[2]
		opts, onStart := remotefiles.DownloadOptions{}, js.Undefined()
		if len(args) == 4 && !args[3].IsUndefined() {
			var err error
			if opts, onStart, err = downloadOptions(args[3]); err != nil {
				return promise(func() (any, error) { return nil, err })
			}
		}
		return promise(func() (any, error) { return f.download(name, chunk, progress, opts, onStart) })
	})
	cancel := js.FuncOf(func(_ js.Value, _ []js.Value) any {
		f.mu.Lock()
		if f.active != nil {
			f.active.cancel()
		}
		f.mu.Unlock()
		return nil
	})
	closeFiles := js.FuncOf(func(_ js.Value, _ []js.Value) any {
		go func() { _ = f.close() }()
		return nil
	})
	f.funcs = []js.Func{list, upload, download, cancel, closeFiles}
	return js.ValueOf(map[string]any{"list": list, "upload": upload, "download": download, "cancel": cancel, "close": closeFiles})
}

// percentReporter calls the page's progress callback only when the whole
// percentage changes, so a large transfer does not make one call per packet.
type percentReporter struct {
	callback js.Value
	last     int
	err      error
}

func (p *percentReporter) report(done, total int64) {
	percent := 100
	if total > 0 {
		percent = int(done * 100 / total)
	}
	if percent == p.last || p.err != nil {
		return
	}
	p.last = percent
	_, p.err = callJS(p.callback, "call", js.Null(), percent)
}

func (f *sftpBridge) upload(name string, local js.Value, overwrite bool, progress js.Value) error {
	ctx, t, err := f.start()
	if err != nil {
		return err
	}
	defer f.finish(t)
	size := int64(local.Get("size").Float())
	reporter := &percentReporter{callback: progress, last: -1}
	reporter.report(0, max(size, 1))
	err = remotefiles.Upload(ctx, f.client, name, &jsFileReader{file: local, size: size}, size, overwrite, func(n int64) { reporter.report(n, size) })
	if err != nil {
		return err
	}
	reporter.report(size, size)
	return reporter.err
}

// downloadOptions reads the page's { offset, expectSize, expectMtime, tail,
// onStart } object. Every field is optional; offset defaults to 0.
func downloadOptions(v js.Value) (remotefiles.DownloadOptions, js.Value, error) {
	invalid := errors.New("invalid download options")
	var opts remotefiles.DownloadOptions
	if v.Type() != js.TypeObject {
		return opts, js.Undefined(), invalid
	}
	numbers := []struct {
		key string
		dst *int64
	}{{"offset", &opts.Offset}, {"expectSize", &opts.ExpectSize}, {"expectMtime", &opts.ExpectMtime}}
	for _, n := range numbers {
		field := v.Get(n.key)
		if field.IsUndefined() {
			continue
		}
		// 2^53 bounds the integers a JS number holds exactly.
		if field.Type() != js.TypeNumber || field.Float() != float64(int64(field.Float())) || math.Abs(field.Float()) > 1<<53 {
			return opts, js.Undefined(), invalid
		}
		*n.dst = int64(field.Float())
	}
	if tail := v.Get("tail"); !tail.IsUndefined() {
		if !tail.InstanceOf(js.Global().Get("Uint8Array")) {
			return opts, js.Undefined(), invalid
		}
		opts.Tail = make([]byte, tail.Length())
		js.CopyBytesToGo(opts.Tail, tail)
	}
	onStart := v.Get("onStart")
	if !onStart.IsUndefined() && onStart.Type() != js.TypeFunction {
		return opts, js.Undefined(), invalid
	}
	return opts, onStart, nil
}

func (f *sftpBridge) download(name string, chunk, progress js.Value, opts remotefiles.DownloadOptions, onStart js.Value) (any, error) {
	ctx, t, err := f.start()
	if err != nil {
		return nil, err
	}
	defer f.finish(t)
	reporter := &percentReporter{callback: progress, last: -1}
	var size int64
	var startErr error
	var start func(size, mtime int64)
	if !onStart.IsUndefined() {
		start = func(size, mtime int64) {
			// A throwing onStart stops the transfer before any chunk is written.
			if _, startErr = callJS(onStart, "call", js.Null(), map[string]any{"size": float64(size), "mtime": float64(mtime)}); startErr != nil {
				t.cancel()
			}
		}
	}
	grew, err := remotefiles.Download(ctx, f.client, name, jsChunkWriter{chunk: chunk}, opts, start, func(done, total int64) {
		size = total
		reporter.report(done, total)
	})
	if startErr != nil {
		return nil, startErr
	}
	if err != nil {
		return nil, err
	}
	reporter.report(1, 1)
	if reporter.err != nil {
		return nil, reporter.err
	}
	return map[string]any{"grew": grew, "size": float64(size)}, nil
}

// jsFileReader reads a browser File in slices, so the file is never held in
// memory whole.
type jsFileReader struct {
	file   js.Value
	size   int64
	offset int64
}

func (r *jsFileReader) Read(p []byte) (int, error) {
	if r.offset >= r.size {
		return 0, io.EOF
	}
	if len(p) == 0 {
		return 0, nil
	}
	end := min(r.offset+int64(len(p)), r.size)
	buffer, err := awaitPromise(r.file.Call("slice", float64(r.offset), float64(end)).Call("arrayBuffer"))
	if err != nil {
		return 0, err
	}
	n := js.CopyBytesToGo(p, js.Global().Get("Uint8Array").New(buffer))
	if n == 0 {
		return 0, io.ErrUnexpectedEOF
	}
	r.offset += int64(n)
	return n, nil
}

// jsChunkWriter hands each chunk to the page and waits for its Promise, so
// the page's storage applies backpressure to the download.
type jsChunkWriter struct{ chunk js.Value }

func (w jsChunkWriter) Write(p []byte) (int, error) {
	data := js.Global().Get("Uint8Array").New(len(p))
	js.CopyBytesToJS(data, p)
	written, err := callJS(w.chunk, "call", js.Null(), data)
	if err != nil {
		return 0, err
	}
	if _, err := awaitPromise(written); err != nil {
		return 0, err
	}
	return len(p), nil
}
