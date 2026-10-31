package remotefiles

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/pkg/sftp"

	"engine/sshclient"
)

// connect starts the in-process test server rooted at a new temporary
// directory and opens an SFTP client with the panel's options.
func connect(t *testing.T) (*sftp.Client, string) {
	t.Helper()
	server, err := sshclient.NewTestServer("tester", "secret")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Close() })
	root := t.TempDir()
	server.EnableSFTP(root)
	conn, err := net.Dial("tcp", server.Addr)
	if err != nil {
		t.Fatal(err)
	}
	session, err := sshclient.Connect(t.Context(), conn, server.Addr, "tester", "secret", func(string, sshclient.HostKeyFingerprint) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = session.Close() })
	client, err := sftp.NewClient(session.Client(), ClientOptions()...)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Close() })
	return client, root
}

func randomBytes(t *testing.T, n int) []byte {
	t.Helper()
	data := make([]byte, n)
	if _, err := rand.Read(data); err != nil {
		t.Fatal(err)
	}
	return data
}

func tempFiles(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), TempPrefix) {
			names = append(names, entry.Name())
		}
	}
	return names
}

func TestListResolvesLinksAndPath(t *testing.T) {
	client, root := connect(t)
	if err := os.Mkdir(filepath.Join(root, "logs"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "notes.txt"), []byte("12345"), 0o644); err != nil {
		t.Fatal(err)
	}
	for link, target := range map[string]string{"logs-link": "logs", "notes-link": "notes.txt", "broken-link": "missing"} {
		if err := os.Symlink(target, filepath.Join(root, link)); err != nil {
			t.Fatal(err)
		}
	}
	resolved, entries, err := List(client, "logs/..", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if resolved != "/" {
		t.Fatalf("resolved path: %q", resolved)
	}
	got := map[string]Entry{}
	for _, entry := range entries {
		got[entry.Name] = entry
	}
	want := map[string]Entry{
		"logs":        {Name: "logs", Kind: Folder, Size: got["logs"].Size},
		"notes.txt":   {Name: "notes.txt", Kind: File, Size: 5},
		"logs-link":   {Name: "logs-link", Kind: Folder, IsLink: true, Size: got["logs-link"].Size},
		"notes-link":  {Name: "notes-link", Kind: File, IsLink: true, Size: 5},
		"broken-link": {Name: "broken-link", Kind: Broken, IsLink: true},
	}
	if len(got) != len(want) {
		t.Fatalf("entries: %+v", entries)
	}
	for name, entry := range want {
		if got[name] != entry {
			t.Errorf("%s: got %+v, want %+v", name, got[name], entry)
		}
	}
	sub, _, err := List(client, "logs", time.Now())
	if err != nil || sub != "/logs" {
		t.Fatalf("subfolder path %q, err %v", sub, err)
	}
}

func TestListRemovesOnlyStaleTemps(t *testing.T) {
	client, root := connect(t)
	stale := filepath.Join(root, TempPrefix+"old")
	fresh := filepath.Join(root, TempPrefix+"new")
	for _, name := range []string{stale, fresh} {
		if err := os.WriteFile(name, []byte("partial"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	old := time.Now().Add(-StaleTempAge - time.Hour)
	if err := os.Chtimes(stale, old, old); err != nil {
		t.Fatal(err)
	}
	_, entries, err := List(client, ".", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name != TempPrefix+"new" {
		t.Fatalf("entries: %+v", entries)
	}
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Fatalf("stale temp still present: %v", err)
	}
}

func TestUploadDownloadLargerThanOneChunk(t *testing.T) {
	client, root := connect(t)
	data := randomBytes(t, 3<<20+17)
	var last int64
	if err := Upload(t.Context(), client, "big.bin", bytes.NewReader(data), int64(len(data)), false, func(n int64) { last = n }); err != nil {
		t.Fatal(err)
	}
	if last != int64(len(data)) {
		t.Fatalf("progress ended at %d of %d", last, len(data))
	}
	onDisk, err := os.ReadFile(filepath.Join(root, "big.bin"))
	if err != nil || !bytes.Equal(onDisk, data) {
		t.Fatalf("uploaded bytes differ (err %v, %d bytes)", err, len(onDisk))
	}
	var got bytes.Buffer
	var done, total int64
	if err := Download(t.Context(), client, "big.bin", &got, func(d, tot int64) { done, total = d, tot }); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got.Bytes(), data) || done != total || total != int64(len(data)) {
		t.Fatalf("download: %d bytes, progress %d/%d", got.Len(), done, total)
	}
	if names := tempFiles(t, root); len(names) != 0 {
		t.Fatalf("temp files left: %v", names)
	}
}

func TestUploadEmptyFile(t *testing.T) {
	client, root := connect(t)
	if err := Upload(t.Context(), client, "empty", bytes.NewReader(nil), 0, false, nil); err != nil {
		t.Fatal(err)
	}
	if info, err := os.Stat(filepath.Join(root, "empty")); err != nil || info.Size() != 0 {
		t.Fatalf("empty upload: %v %v", info, err)
	}
}

func TestUploadRefusesExistingWithoutOverwrite(t *testing.T) {
	client, root := connect(t)
	target := filepath.Join(root, "keep.txt")
	if err := os.WriteFile(target, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	err := Upload(t.Context(), client, "keep.txt", strings.NewReader("new"), 3, false, nil)
	if !errors.Is(err, ErrExists) {
		t.Fatalf("got %v, want ErrExists", err)
	}
	if got, _ := os.ReadFile(target); string(got) != "old" {
		t.Fatalf("target changed: %q", got)
	}
	if names := tempFiles(t, root); len(names) != 0 {
		t.Fatalf("temp files left: %v", names)
	}
}

func TestUploadDetectsTargetCreatedDuringTransfer(t *testing.T) {
	client, root := connect(t)
	target := filepath.Join(root, "race.txt")
	created := false
	err := Upload(t.Context(), client, "race.txt", strings.NewReader("new"), 3, false, func(int64) {
		if !created {
			created = true
			if err := os.WriteFile(target, []byte("theirs"), 0o644); err != nil {
				t.Error(err)
			}
		}
	})
	if !errors.Is(err, ErrExists) {
		t.Fatalf("got %v, want ErrExists", err)
	}
	if got, _ := os.ReadFile(target); string(got) != "theirs" {
		t.Fatalf("target changed: %q", got)
	}
	if names := tempFiles(t, root); len(names) != 0 {
		t.Fatalf("temp files left: %v", names)
	}
}

func TestReplaceKeepsMode(t *testing.T) {
	client, root := connect(t)
	target := filepath.Join(root, "deploy.sh")
	if err := os.WriteFile(target, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(target, 0o751); err != nil {
		t.Fatal(err)
	}
	if err := Upload(t.Context(), client, "deploy.sh", strings.NewReader("echo new"), 8, true, nil); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o751 {
		t.Fatalf("mode %v, want 0751", info.Mode().Perm())
	}
	if got, _ := os.ReadFile(target); string(got) != "echo new" {
		t.Fatalf("content %q", got)
	}
}

func TestReplaceSymlinkReplacesLink(t *testing.T) {
	client, root := connect(t)
	if err := os.WriteFile(filepath.Join(root, "real.txt"), []byte("real"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("real.txt", filepath.Join(root, "link.txt")); err != nil {
		t.Fatal(err)
	}
	if err := Upload(t.Context(), client, "link.txt", strings.NewReader("new"), 3, true, nil); err != nil {
		t.Fatal(err)
	}
	info, err := os.Lstat(filepath.Join(root, "link.txt"))
	if err != nil || !info.Mode().IsRegular() {
		t.Fatalf("link.txt is %v (%v), want a regular file", info, err)
	}
	if got, _ := os.ReadFile(filepath.Join(root, "real.txt")); string(got) != "real" {
		t.Fatalf("link target changed: %q", got)
	}
}

func TestReplaceWithoutPosixRename(t *testing.T) {
	if err := sftp.SetSFTPExtensions("statvfs@openssh.com"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = sftp.SetSFTPExtensions("hardlink@openssh.com", "posix-rename@openssh.com", "statvfs@openssh.com")
	})
	client, root := connect(t)
	if _, ok := client.HasExtension(posixRename); ok {
		t.Fatal("server still advertises posix-rename")
	}
	target := filepath.Join(root, "file.txt")
	if err := os.WriteFile(target, []byte("old"), 0o640); err != nil {
		t.Fatal(err)
	}
	if err := Upload(t.Context(), client, "file.txt", strings.NewReader("newer"), 5, true, nil); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(target)
	if err != nil || info.Mode().Perm() != 0o640 {
		t.Fatalf("mode %v err %v", info, err)
	}
	if got, _ := os.ReadFile(target); string(got) != "newer" {
		t.Fatalf("content %q", got)
	}
	if names := tempFiles(t, root); len(names) != 0 {
		t.Fatalf("temp files left: %v", names)
	}
}

func TestCancelledUploadRemovesTemp(t *testing.T) {
	client, root := connect(t)
	target := filepath.Join(root, "keep.bin")
	if err := os.WriteFile(target, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	data := randomBytes(t, 2<<20)
	err := Upload(ctx, client, "keep.bin", bytes.NewReader(data), int64(len(data)), true, func(n int64) {
		if n >= 64<<10 {
			cancel()
		}
	})
	if !errors.Is(err, ErrCancelled) {
		t.Fatalf("got %v, want ErrCancelled", err)
	}
	if got, _ := os.ReadFile(target); string(got) != "old" {
		t.Fatalf("target changed: %d bytes", len(got))
	}
	if names := tempFiles(t, root); len(names) != 0 {
		t.Fatalf("temp files left: %v", names)
	}
}

func TestCancelledDownload(t *testing.T) {
	client, root := connect(t)
	if err := os.WriteFile(filepath.Join(root, "big.bin"), randomBytes(t, 2<<20), 0o644); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	var got bytes.Buffer
	err := Download(ctx, client, "big.bin", &got, func(done, _ int64) {
		if done >= 64<<10 {
			cancel()
		}
	})
	if !errors.Is(err, ErrCancelled) {
		t.Fatalf("got %v, want ErrCancelled", err)
	}
	if got.Len() >= 2<<20 {
		t.Fatal("download ran to completion after cancel")
	}
}

func TestDownloadRejectsFolderAndFollowsLink(t *testing.T) {
	client, root := connect(t)
	if err := os.Mkdir(filepath.Join(root, "dir"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := Download(t.Context(), client, "dir", &bytes.Buffer{}, nil); err == nil || !strings.Contains(err.Error(), "not a regular file") {
		t.Fatalf("folder download: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "real.txt"), []byte("via link"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("real.txt", filepath.Join(root, "link")); err != nil {
		t.Fatal(err)
	}
	var got bytes.Buffer
	if err := Download(t.Context(), client, "link", &got, nil); err != nil || got.String() != "via link" {
		t.Fatalf("link download %q, err %v", got.String(), err)
	}
}

func TestUploadRejectsFolderTarget(t *testing.T) {
	client, root := connect(t)
	if err := os.Mkdir(filepath.Join(root, "dir"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, overwrite := range []bool{false, true} {
		if err := Upload(t.Context(), client, "dir", strings.NewReader("x"), 1, overwrite, nil); err == nil || !strings.Contains(err.Error(), "is a folder") {
			t.Fatalf("overwrite %v: got %v", overwrite, err)
		}
	}
	for _, name := range []string{"", ".", "/"} {
		if err := Upload(t.Context(), client, name, strings.NewReader("x"), 1, false, nil); err == nil {
			t.Fatalf("upload to %q accepted", name)
		}
	}
}
