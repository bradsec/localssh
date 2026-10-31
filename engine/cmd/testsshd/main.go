// Command testsshd starts an in-process SSH test server (from
// engine/sshclient.NewTestServer) and prints its listen address on stdout,
// then blocks so external test harnesses (the Task 7 spike test) can spawn
// it as a subprocess and dial a real SSH server without needing docker or
// a system sshd installed.
//
// Usage: testsshd <username> <password> [authorized_keys file]
//
// Keys in the optional authorized_keys file may also log in as username.
package main

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"

	"engine/sshclient"

	"golang.org/x/crypto/ssh"
)

func main() {
	if len(os.Args) != 3 && len(os.Args) != 4 {
		fmt.Fprintln(os.Stderr, "usage: testsshd <username> <password> [authorized_keys file]")
		os.Exit(1)
	}
	server, err := sshclient.NewTestServer(os.Args[1], os.Args[2])
	if err != nil {
		fmt.Fprintln(os.Stderr, "start test server:", err)
		os.Exit(1)
	}
	defer server.Close()
	if len(os.Args) == 4 {
		if err := authorizeKeys(server, os.Args[3]); err != nil {
			fmt.Fprintln(os.Stderr, "authorized keys:", err)
			os.Exit(1)
		}
	}

	fmt.Println(server.Addr)
	if _, err := bufio.NewReader(os.Stdin).ReadString('\n'); err != nil && !errors.Is(err, io.EOF) {
		fmt.Fprintln(os.Stderr, "wait for parent:", err)
		os.Exit(1)
	}
}

func authorizeKeys(server *sshclient.TestServer, path string) error {
	rest, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	for len(bytes.TrimSpace(rest)) > 0 {
		var pub ssh.PublicKey
		pub, _, _, rest, err = ssh.ParseAuthorizedKey(rest)
		if err != nil {
			return fmt.Errorf("%s: %w", path, err)
		}
		server.AuthorizeKey(pub)
	}
	return nil
}
