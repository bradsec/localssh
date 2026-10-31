// Package remotefiles implements the SFTP panel's listing, upload, and
// download on top of pkg/sftp. It has no browser dependency, so its behavior
// is tested against the in-process test server; engine/sftpjs.go adapts it to
// JavaScript.
package remotefiles

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"strings"
	"time"

	"github.com/pkg/sftp"
)

const (
	// TempPrefix starts the name of every staged upload.
	TempPrefix = ".localssh-upload-"
	// StaleTempAge is how old a staged upload must be before List removes it.
	// It is long so that clock skew between browser and server, or a slow
	// upload from another tab, cannot remove a temp file still being written.
	StaleTempAge = 24 * time.Hour
	// MaxInFlight bounds the SFTP requests outstanding per transfer. With
	// pkg/sftp's 32 KiB packets that is 512 KiB in flight, which keeps a
	// transfer from filling the shared connection ahead of terminal traffic.
	MaxInFlight = 16
	posixRename = "posix-rename@openssh.com"
)

var (
	// ErrExists reports that an upload without overwrite found its target.
	ErrExists = errors.New("remote file exists")
	// ErrCancelled reports that the caller cancelled the transfer.
	ErrCancelled = errors.New("transfer cancelled")
)

// ClientOptions configures pkg/sftp for bounded concurrent transfers.
func ClientOptions() []sftp.ClientOption {
	return []sftp.ClientOption{
		sftp.UseConcurrentReads(true),
		sftp.UseConcurrentWrites(true),
		sftp.MaxConcurrentRequestsPerFile(MaxInFlight),
	}
}

// Kind is what a listing entry is, after following a symbolic link.
type Kind string

const (
	File   Kind = "file"
	Folder Kind = "folder"
	Other  Kind = "other"
	// Broken is a symbolic link whose target cannot be read.
	Broken Kind = "broken"
)

// maxListEntries bounds how many names List returns, so a hostile or huge
// folder cannot flood the page. A variable so tests can lower it.
var maxListEntries = 10000

// Entry is one name in a directory listing.
type Entry struct {
	Name   string
	Kind   Kind
	IsLink bool
	Size   int64
}

// List reads dir, resolves symbolic links for display, and removes this
// app's staged uploads older than StaleTempAge relative to now. It returns
// the server's absolute form of dir. It returns at most maxListEntries
// entries and reports truncated when the folder held more.
func List(c *sftp.Client, dir string, now time.Time) (string, []Entry, bool, error) {
	infos, err := c.ReadDir(dir)
	if err != nil {
		return "", nil, false, err
	}
	truncated := len(infos) > maxListEntries
	if truncated {
		infos = infos[:maxListEntries]
	}
	resolved, err := c.RealPath(dir)
	if err != nil {
		// The listing succeeded, so show it under the path the user gave
		// rather than failing on a server that rejects realpath.
		resolved = dir
	}
	entries := make([]Entry, 0, len(infos))
	for _, info := range infos {
		full := path.Join(resolved, info.Name())
		if isStaleTemp(info, now) && c.Remove(full) == nil {
			continue
		}
		entry := Entry{Name: info.Name(), Kind: kindOf(info.Mode()), Size: info.Size()}
		if info.Mode()&os.ModeSymlink != 0 {
			entry.IsLink = true
			if target, err := c.Stat(full); err != nil {
				entry.Kind, entry.Size = Broken, 0
			} else {
				entry.Kind, entry.Size = kindOf(target.Mode()), target.Size()
			}
		}
		entries = append(entries, entry)
	}
	return resolved, entries, truncated, nil
}

func isStaleTemp(info os.FileInfo, now time.Time) bool {
	return strings.HasPrefix(info.Name(), TempPrefix) && info.Mode().IsRegular() && now.Sub(info.ModTime()) > StaleTempAge
}

func kindOf(mode os.FileMode) Kind {
	switch {
	case mode.IsDir():
		return Folder
	case mode.IsRegular():
		return File
	default:
		return Other
	}
}

// Upload writes size bytes from src to name through a temporary file in the
// same directory, then renames it into place. On servers without posix-rename,
// a failed replacement rename can leave the old file removed and the staged
// upload as the only copy. Without overwrite it returns ErrExists when name
// exists. With overwrite it keeps the replaced file's permission bits; a
// symbolic link at name is replaced by the file, not followed.
// progress receives the bytes read from src so far.
func Upload(ctx context.Context, c *sftp.Client, name string, src io.Reader, size int64, overwrite bool, progress func(int64)) error {
	if name == "" || path.Base(name) == "." || path.Base(name) == "/" {
		return errors.New("invalid remote file path")
	}
	target, err := c.Lstat(name)
	exists := err == nil
	switch {
	case err != nil && !errors.Is(err, os.ErrNotExist):
		return err
	case exists && target.IsDir():
		return fmt.Errorf("%s is a folder", name)
	case exists && !overwrite:
		return ErrExists
	}

	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		return err
	}
	temp := path.Join(path.Dir(name), fmt.Sprintf("%s%x", TempPrefix, random))
	remote, err := c.OpenFile(temp, os.O_CREATE|os.O_WRONLY|os.O_EXCL)
	if err != nil {
		return err
	}
	keepTemp := false
	defer func() {
		if !keepTemp {
			_ = c.Remove(temp)
		}
	}()
	written, err := remote.ReadFrom(&cancelReader{ctx: ctx, r: io.LimitReader(src, size), size: size, progress: progress})
	if err != nil {
		_ = remote.Close()
		return err
	}
	if err := remote.Close(); err != nil {
		return err
	}
	if written != size {
		return fmt.Errorf("upload source ended after %d of %d bytes", written, size)
	}
	if err := ctx.Err(); err != nil {
		return ErrCancelled
	}

	if !exists {
		if err := c.Rename(temp, name); err != nil {
			// OpenSSH answers a rename onto an existing name with a generic
			// SSH_FX_FAILURE, so a file created after the Lstat above is only
			// recognisable by looking again.
			if _, statErr := c.Lstat(name); statErr == nil {
				return ErrExists
			}
			return err
		}
		return nil
	}
	if target.Mode().IsRegular() {
		if err := c.Chmod(temp, target.Mode()&os.ModePerm); err != nil {
			return fmt.Errorf("keep permissions of %s: %w", name, err)
		}
	}
	if _, ok := c.HasExtension(posixRename); ok {
		return c.PosixRename(temp, name)
	}
	// Without posix-rename, plain SFTP rename refuses an existing target, so
	// remove it first. If the rename then fails, the old file is gone and the
	// upload is the only copy: keep it and say where.
	if err := c.Remove(name); err != nil {
		return err
	}
	if err := c.Rename(temp, name); err != nil {
		keepTemp = true
		return fmt.Errorf("replace %s: removed the old file but could not rename the upload; it is kept at %s: %w", name, temp, err)
	}
	return nil
}

type cancelReader struct {
	ctx      context.Context
	r        io.Reader
	size     int64
	read     int64
	progress func(int64)
}

// Size lets pkg/sftp's ReadFrom choose concurrent writes.
func (r *cancelReader) Size() int64 { return r.size }

func (r *cancelReader) Read(p []byte) (int, error) {
	if r.ctx.Err() != nil {
		return 0, ErrCancelled
	}
	n, err := r.r.Read(p)
	if n > 0 {
		r.read += int64(n)
		if r.progress != nil {
			r.progress(r.read)
		}
	}
	return n, err
}

// errGrew stops a download that reached the size Stat reported.
var errGrew = errors.New("file grew during download")

// Download streams the regular file at name, following a symbolic link, to
// dst. progress receives bytes written and the file's size. It writes at most
// the size Stat reported when it started and returns grew when the server had
// more data.
func Download(ctx context.Context, c *sftp.Client, name string, dst io.Writer, progress func(done, total int64)) (grew bool, err error) {
	info, err := c.Stat(name)
	if err != nil {
		return false, err
	}
	if !info.Mode().IsRegular() {
		return false, errors.New("not a regular file")
	}
	remote, err := c.Open(name)
	if err != nil {
		return false, err
	}
	defer remote.Close()
	w := &cancelWriter{ctx: ctx, w: dst, total: info.Size(), progress: progress}
	if _, err := remote.WriteTo(w); err != nil {
		if ctx.Err() != nil {
			return false, ErrCancelled
		}
		if errors.Is(err, errGrew) {
			return true, nil
		}
		return false, err
	}
	if ctx.Err() != nil {
		return false, ErrCancelled
	}
	return false, nil
}

type cancelWriter struct {
	ctx      context.Context
	w        io.Writer
	written  int64
	total    int64
	progress func(done, total int64)
}

func (w *cancelWriter) Write(p []byte) (int, error) {
	if w.ctx.Err() != nil {
		return 0, ErrCancelled
	}
	extra := false
	if remaining := w.total - w.written; int64(len(p)) > remaining {
		p, extra = p[:remaining], true
	}
	n, err := w.w.Write(p)
	w.written += int64(n)
	if err == nil && extra {
		err = errGrew
	}
	if w.progress != nil {
		w.progress(w.written, w.total)
	}
	return n, err
}
