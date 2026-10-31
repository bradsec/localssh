package sshclient

import (
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/ssh"
)

// The page maps these messages to its error copy
// (frontend/src/connectionErrors.ts), so their text is a contract.
var (
	ErrKeyInvalid     = errors.New("private key could not be read")
	ErrKeyUnsupported = errors.New("private key format not supported")
	ErrKeyPassphrase  = errors.New("key passphrase did not unlock the key")
	ErrKeyRejected    = errors.New("private key rejected by server")
)

// supportedKeyTypes lists the key algorithms localssh accepts. x/crypto also
// parses DSA keys, which OpenSSH has removed, so they are refused here.
var supportedKeyTypes = map[string]bool{
	ssh.KeyAlgoED25519:  true,
	ssh.KeyAlgoECDSA256: true,
	ssh.KeyAlgoECDSA384: true,
	ssh.KeyAlgoECDSA521: true,
	ssh.KeyAlgoRSA:      true,
}

// ParsePrivateKey reads Ed25519, ECDSA, or RSA OpenSSH keys, unencrypted PKCS#8
// PEM keys, and legacy RSA or EC PEM keys. passphrase is used only when the
// key is encrypted. Errors wrap ErrKeyInvalid, ErrKeyUnsupported, or ErrKeyPassphrase.
func ParsePrivateKey(pemBytes, passphrase []byte) (ssh.Signer, error) {
	if block, _ := pem.Decode(pemBytes); block != nil && block.Type == "ENCRYPTED PRIVATE KEY" {
		return nil, ErrKeyUnsupported
	}
	signer, err := ssh.ParsePrivateKey(pemBytes)
	var missing *ssh.PassphraseMissingError
	if errors.As(err, &missing) {
		if len(passphrase) == 0 {
			return nil, ErrKeyPassphrase
		}
		signer, err = ssh.ParsePrivateKeyWithPassphrase(pemBytes, passphrase)
	}
	switch {
	case errors.Is(err, x509.IncorrectPasswordError):
		return nil, ErrKeyPassphrase
	case err != nil && strings.Contains(err.Error(), "unsupported key type"):
		return nil, fmt.Errorf("%w: %v", ErrKeyUnsupported, err)
	case err != nil:
		return nil, fmt.Errorf("%w: %v", ErrKeyInvalid, err)
	}
	if keyType := signer.PublicKey().Type(); !supportedKeyTypes[keyType] {
		return nil, fmt.Errorf("%w: %s", ErrKeyUnsupported, keyType)
	}
	return signer, nil
}
