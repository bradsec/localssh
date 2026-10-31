package sshclient

import (
	"crypto/dsa"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/asn1"
	"encoding/pem"
	"errors"
	"math/big"
	"net"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

func marshalKey(t *testing.T, key any, passphrase string) []byte {
	t.Helper()
	var block *pem.Block
	var err error
	if passphrase == "" {
		block, err = ssh.MarshalPrivateKey(key, "")
	} else {
		block, err = ssh.MarshalPrivateKeyWithPassphrase(key, "", []byte(passphrase))
	}
	if err != nil {
		t.Fatalf("marshal key: %v", err)
	}
	return pem.EncodeToMemory(block)
}

func TestParsePrivateKeyAcceptsSupportedTypes(t *testing.T) {
	_, edKey, _ := ed25519.GenerateKey(rand.Reader)
	ecKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	rsaKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	tests := []struct {
		name, passphrase, wantType string
		key                        any
	}{
		{"ed25519", "", ssh.KeyAlgoED25519, edKey},
		{"ed25519 with passphrase", "pass phrase", ssh.KeyAlgoED25519, edKey},
		{"ecdsa", "", ssh.KeyAlgoECDSA256, ecKey},
		{"ecdsa with passphrase", "pass phrase", ssh.KeyAlgoECDSA256, ecKey},
		{"rsa", "", ssh.KeyAlgoRSA, rsaKey},
		{"rsa with passphrase", "pass phrase", ssh.KeyAlgoRSA, rsaKey},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pemBytes := marshalKey(t, tt.key, tt.passphrase)
			signer, err := ParsePrivateKey(pemBytes, []byte(tt.passphrase))
			if err != nil {
				t.Fatalf("parse: %v", err)
			}
			if got := signer.PublicKey().Type(); got != tt.wantType {
				t.Fatalf("key type %q, want %q", got, tt.wantType)
			}
		})
	}
}

func TestParsePrivateKeyIgnoresPassphraseForUnencryptedKey(t *testing.T) {
	_, edKey, _ := ed25519.GenerateKey(rand.Reader)
	if _, err := ParsePrivateKey(marshalKey(t, edKey, ""), []byte("unused")); err != nil {
		t.Fatalf("parse: %v", err)
	}
}

func TestParsePrivateKeyErrors(t *testing.T) {
	_, edKey, _ := ed25519.GenerateKey(rand.Reader)
	encrypted := marshalKey(t, edKey, "right")

	var dsaKey dsa.PrivateKey
	if err := dsa.GenerateParameters(&dsaKey.Parameters, rand.Reader, dsa.L1024N160); err != nil {
		t.Fatalf("dsa params: %v", err)
	}
	if err := dsa.GenerateKey(&dsaKey, rand.Reader); err != nil {
		t.Fatalf("dsa key: %v", err)
	}
	// x/crypto cannot marshal DSA keys, so build the legacy PEM form by hand.
	dsaDER, err := asn1.Marshal(struct {
		Version            int
		P, Q, G, Pub, Priv *big.Int
	}{0, dsaKey.P, dsaKey.Q, dsaKey.G, dsaKey.Y, dsaKey.X})
	if err != nil {
		t.Fatalf("dsa der: %v", err)
	}
	dsaPEM := pem.EncodeToMemory(&pem.Block{Type: "DSA PRIVATE KEY", Bytes: dsaDER})

	pkcs8, _ := x509.MarshalPKCS8PrivateKey(edKey)
	unknownBlock := pem.EncodeToMemory(&pem.Block{Type: "PGP PRIVATE KEY BLOCK", Bytes: pkcs8})

	tests := []struct {
		name       string
		key        []byte
		passphrase string
		want       error
	}{
		{"empty", nil, "", ErrKeyInvalid},
		{"not a key", []byte("hello world"), "", ErrKeyInvalid},
		{"public key", []byte("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA== x"), "", ErrKeyInvalid},
		{"truncated", encrypted[:len(encrypted)/2], "", ErrKeyInvalid},
		{"missing passphrase", encrypted, "", ErrKeyPassphrase},
		{"wrong passphrase", encrypted, "wrong", ErrKeyPassphrase},
		{"dsa", dsaPEM, "", ErrKeyUnsupported},
		{"unknown pem type", unknownBlock, "", ErrKeyUnsupported},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ParsePrivateKey(tt.key, []byte(tt.passphrase))
			if !errors.Is(err, tt.want) {
				t.Fatalf("got %v, want %v", err, tt.want)
			}
		})
	}
}

func newKeyServer(t *testing.T) (*TestServer, ssh.Signer) {
	t.Helper()
	server, err := NewTestServer("tester", "s3cret")
	if err != nil {
		t.Fatalf("start test server: %v", err)
	}
	t.Cleanup(func() { server.Close() })
	_, edKey, _ := ed25519.GenerateKey(rand.Reader)
	signer, err := ssh.NewSignerFromKey(edKey)
	if err != nil {
		t.Fatalf("signer: %v", err)
	}
	server.AuthorizeKey(signer.PublicKey())
	return server, signer
}

func dialServer(t *testing.T, server *TestServer) net.Conn {
	t.Helper()
	conn, err := net.DialTimeout("tcp", server.Addr, 2*time.Second)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	return conn
}

func TestConnectWithKeyAuthenticatesAndVerifiesHostKey(t *testing.T) {
	server, signer := newKeyServer(t)

	verified := false
	verify := func(string, HostKeyFingerprint) error { verified = true; return nil }
	session, err := ConnectWithKey(t.Context(), dialServer(t, server), server.Addr, "tester", signer, verify)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer session.Close()
	if !verified {
		t.Fatal("host key was not verified")
	}
	if err := session.RequestPTY(t.Context(), 80, 24); err != nil {
		t.Fatalf("request pty: %v", err)
	}
}

func TestConnectWithKeyStillChecksHostKey(t *testing.T) {
	server, signer := newKeyServer(t)
	sentinel := errors.New("host key rejected")
	verify := func(string, HostKeyFingerprint) error { return sentinel }
	_, err := ConnectWithKey(t.Context(), dialServer(t, server), server.Addr, "tester", signer, verify)
	if !errors.Is(err, sentinel) {
		t.Fatalf("got %v, want host key rejection", err)
	}
}

func TestConnectWithKeyReportsRejectedKey(t *testing.T) {
	server, _ := newKeyServer(t)
	_, otherKey, _ := ed25519.GenerateKey(rand.Reader)
	other, _ := ssh.NewSignerFromKey(otherKey)
	verify := func(string, HostKeyFingerprint) error { return nil }
	_, err := ConnectWithKey(t.Context(), dialServer(t, server), server.Addr, "tester", other, verify)
	if !errors.Is(err, ErrKeyRejected) {
		t.Fatalf("got %v, want ErrKeyRejected", err)
	}
}

func TestPasswordLoginUnaffectedByAuthorizedKey(t *testing.T) {
	server, _ := newKeyServer(t)
	verify := func(string, HostKeyFingerprint) error { return nil }
	session, err := Connect(t.Context(), dialServer(t, server), server.Addr, "tester", "s3cret", verify)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	session.Close()
}
