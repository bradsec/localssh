package sshclient

import (
	"bytes"
	"context"
	"io"
	"net"
	"os"
	"path/filepath"
	"testing"

	"github.com/pkg/sftp"
)

func TestSFTPOverExistingSession(t *testing.T) {
	server, err := NewTestServer("tester", "secret")
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
	session, err := Connect(t.Context(), conn, server.Addr, "tester", "secret", func(string, HostKeyFingerprint) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = session.Close() })
	if err := session.RequestPTY(context.Background(), 80, 24); err != nil {
		t.Fatal(err)
	}
	files, err := sftp.NewClient(session.Client())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = files.Close() })
	remote, err := files.OpenFile("sample.txt", os.O_CREATE|os.O_WRONLY|os.O_EXCL)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := remote.Write([]byte("SFTP round trip")); err != nil {
		t.Fatal(err)
	}
	if err := remote.Close(); err != nil {
		t.Fatal(err)
	}
	entries, err := files.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "sample.txt" {
		t.Fatalf("entries: %v", entries)
	}
	remote, err = files.Open("sample.txt")
	if err != nil {
		t.Fatal(err)
	}
	got, err := io.ReadAll(remote)
	if err != nil {
		t.Fatal(err)
	}
	if err := remote.Close(); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, []byte("SFTP round trip")) {
		t.Fatalf("download: %q", got)
	}
	onDisk, err := os.ReadFile(filepath.Join(root, "sample.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(onDisk, got) {
		t.Fatalf("disk: %q", onDisk)
	}
	if _, err := files.Open("/etc/passwd"); err == nil {
		t.Fatal("test server read outside its temporary root")
	}
	if err := os.Symlink(filepath.Dir(root), filepath.Join(root, "escape")); err != nil {
		t.Fatal(err)
	}
	if _, err := files.ReadDir("escape"); err == nil {
		t.Fatal("test server followed a symlink outside its temporary root")
	}
}
