// Command testsshd starts an in-process SSH test server (from
// engine/sshclient.NewTestServer) and prints its listen address on stdout,
// then blocks so external test harnesses (the Task 7 spike test) can spawn
// it as a subprocess and dial a real SSH server without needing docker or
// a system sshd installed.
//
// Usage: testsshd <username> <password>
package main

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"

	"engine/sshclient"
)

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: testsshd <username> <password>")
		os.Exit(1)
	}
	server, err := sshclient.NewTestServer(os.Args[1], os.Args[2])
	if err != nil {
		fmt.Fprintln(os.Stderr, "start test server:", err)
		os.Exit(1)
	}
	defer server.Close()

	fmt.Println(server.Addr)
	if _, err := bufio.NewReader(os.Stdin).ReadString('\n'); err != nil && !errors.Is(err, io.EOF) {
		fmt.Fprintln(os.Stderr, "wait for parent:", err)
		os.Exit(1)
	}
}
