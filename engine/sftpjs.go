//go:build js && wasm

package main

import (
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"sync"
	"sync/atomic"
	"syscall/js"

	"github.com/pkg/sftp"
)

const transferChunkSize = 32 << 10

type sftpBridge struct {
	client *sftp.Client
	mu     sync.Mutex
	active *fileTransfer
	closed bool
	funcs  []js.Func
}

type fileTransfer struct {
	cancelled atomic.Bool
	mu        sync.Mutex
	file      *sftp.File
}

func (t *fileTransfer) setFile(file *sftp.File) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.cancelled.Load() {
		_ = file.Close()
		return errors.New("transfer cancelled")
	}
	t.file = file
	return nil
}

func (t *fileTransfer) cancel() {
	t.cancelled.Store(true)
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.file != nil {
		_ = t.file.Close()
	}
}

func (t *fileTransfer) check() error {
	if t.cancelled.Load() {
		return errors.New("transfer cancelled")
	}
	return nil
}

func (f *sftpBridge) start() (*fileTransfer, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return nil, errors.New("SFTP closed")
	}
	if f.active != nil {
		return nil, errors.New("transfer already in progress")
	}
	t := new(fileTransfer)
	f.active = t
	return t, nil
}

func (f *sftpBridge) finish(t *fileTransfer) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.active == t {
		f.active = nil
	}
}

func (f *sftpBridge) close() error {
	f.mu.Lock()
	if f.closed {
		f.mu.Unlock()
		return nil
	}
	f.closed = true
	active := f.active
	f.mu.Unlock()
	if active != nil {
		active.cancel()
	}
	err := f.client.Close()
	for _, fn := range f.funcs {
		fn.Release()
	}
	return err
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

func awaitPromise(p js.Value) (js.Value, error) {
	type result struct {
		value js.Value
		err   error
	}
	ready := make(chan result, 1)
	ok := js.FuncOf(func(_ js.Value, args []js.Value) any { ready <- result{value: args[0]}; return nil })
	bad := js.FuncOf(func(_ js.Value, args []js.Value) any { ready <- result{err: errors.New(args[0].String())}; return nil })
	p.Call("then", ok, bad)
	r := <-ready
	ok.Release()
	bad.Release()
	return r.value, r.err
}

func (b *sessionBridge) openFiles() js.Value {
	return promise(func() (any, error) {
		client, err := sftp.NewClient(b.session.Client(), sftp.UseConcurrentReads(false), sftp.UseConcurrentWrites(false))
		if err != nil {
			return nil, err
		}
		files := &sftpBridge{client: client}
		value := files.value()
		b.filesMu.Lock()
		if b.closed {
			b.filesMu.Unlock()
			_ = client.Close()
			return nil, errors.New("connection closed")
		}
		if b.files != nil {
			_ = b.files.close()
		}
		b.files = files
		b.filesMu.Unlock()
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
			entries, err := f.client.ReadDir(name)
			if err != nil {
				return nil, err
			}
			items := make([]any, 0, len(entries))
			for _, entry := range entries {
				items = append(items, map[string]any{"name": entry.Name(), "isDir": entry.IsDir(), "size": float64(entry.Size())})
			}
			return items, nil
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
		if len(args) != 3 || args[0].Type() != js.TypeString || args[1].Type() != js.TypeFunction || args[2].Type() != js.TypeFunction {
			return promise(func() (any, error) { return nil, errors.New("invalid download arguments") })
		}
		name, chunk, progress := args[0].String(), args[1], args[2]
		return promise(func() (any, error) { return nil, f.download(name, chunk, progress) })
	})
	cancel := js.FuncOf(func(_ js.Value, _ []js.Value) any {
		f.mu.Lock()
		active := f.active
		f.mu.Unlock()
		if active != nil {
			go active.cancel()
		}
		return nil
	})
	closeFiles := js.FuncOf(func(_ js.Value, _ []js.Value) any {
		go func() { _ = f.close() }()
		return nil
	})
	f.funcs = []js.Func{list, upload, download, cancel, closeFiles}
	return js.ValueOf(map[string]any{"list": list, "upload": upload, "download": download, "cancel": cancel, "close": closeFiles})
}

func (f *sftpBridge) upload(name string, local js.Value, overwrite bool, progress js.Value) error {
	if name == "" || path.Base(name) == "." || path.Base(name) == "/" {
		return errors.New("invalid remote file path")
	}
	t, err := f.start()
	if err != nil {
		return err
	}
	defer f.finish(t)
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		return err
	}
	temp := path.Join(path.Dir(name), fmt.Sprintf(".localssh-upload-%x", random))
	remote, err := f.client.OpenFile(temp, os.O_CREATE|os.O_WRONLY|os.O_EXCL)
	if err != nil {
		return err
	}
	defer func() { _ = f.client.Remove(temp) }()
	if err := t.setFile(remote); err != nil {
		return err
	}
	size := local.Get("size").Float()
	for offset := 0.0; offset < size; {
		if err := t.check(); err != nil {
			return err
		}
		end := min(offset+transferChunkSize, size)
		buffer, err := awaitPromise(local.Call("slice", offset, end).Call("arrayBuffer"))
		if err != nil {
			return err
		}
		data := make([]byte, buffer.Get("byteLength").Int())
		js.CopyBytesToGo(data, js.Global().Get("Uint8Array").New(buffer))
		if _, err := remote.Write(data); err != nil {
			if t.check() != nil {
				return t.check()
			}
			return err
		}
		offset = end
		if _, err := callJS(progress, "call", js.Null(), int(offset*100/size)); err != nil {
			return err
		}
	}
	if err := t.check(); err != nil {
		return err
	}
	if err := remote.Close(); err != nil {
		return err
	}
	t.mu.Lock()
	t.file = nil
	t.mu.Unlock()
	if err := t.check(); err != nil {
		return err
	}
	if overwrite {
		err = f.client.PosixRename(temp, name)
	} else {
		err = f.client.Rename(temp, name)
	}
	if err != nil {
		return err
	}
	if size == 0 {
		_, _ = callJS(progress, "call", js.Null(), 100)
	}
	return nil
}

func (f *sftpBridge) download(name string, chunk, progress js.Value) error {
	t, err := f.start()
	if err != nil {
		return err
	}
	defer f.finish(t)
	info, err := f.client.Stat(name)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("not a regular file")
	}
	remote, err := f.client.Open(name)
	if err != nil {
		return err
	}
	if err := t.setFile(remote); err != nil {
		return err
	}
	defer remote.Close()
	buffer := make([]byte, transferChunkSize)
	var received int64
	for {
		if err := t.check(); err != nil {
			return err
		}
		n, readErr := remote.Read(buffer)
		if n > 0 {
			data := js.Global().Get("Uint8Array").New(n)
			js.CopyBytesToJS(data, buffer[:n])
			written, err := callJS(chunk, "call", js.Null(), data)
			if err != nil {
				return err
			}
			if _, err := awaitPromise(written); err != nil {
				return err
			}
			received += int64(n)
			if info.Size() > 0 {
				if _, err := callJS(progress, "call", js.Null(), int(received*100/info.Size())); err != nil {
					return err
				}
			}
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			if t.check() != nil {
				return t.check()
			}
			return readErr
		}
	}
	if _, err := callJS(progress, "call", js.Null(), 100); err != nil {
		return err
	}
	return t.check()
}
