package vault

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/chacha20poly1305"
)

const (
	saltSize  = 16
	nonceSize = chacha20poly1305.NonceSizeX // 24
	keySize   = chacha20poly1305.KeySize    // 32
)

// Session holds an unlocked vault's key for the life of a page load. The key
// is never returned to JavaScript, and saved SSH passwords are never returned
// after the editor submits them.
type Session struct {
	key    [keySize]byte
	salt   []byte
	params Params
	locked bool
}

// Create derives a key for a new vault under a fresh salt.
func Create(password string, p Params) (*Session, error) {
	if !p.valid() {
		return nil, ErrBadEnvelope
	}
	salt := make([]byte, saltSize)
	if _, err := rand.Read(salt); err != nil {
		return nil, err
	}
	return newSession(password, salt, p), nil
}

// Unlock opens a stored envelope, returning the session and the plaintext.
func Unlock(blob, password string) (*Session, []byte, error) {
	envelope, salt, nonce, ciphertext, err := parseEnvelope(blob)
	if err != nil {
		return nil, nil, err
	}

	params := Params{Time: envelope.T, MemoryKiB: envelope.M, Lanes: envelope.P}
	session := newSession(password, salt, params)

	aead, err := chacha20poly1305.NewX(session.key[:])
	if err != nil {
		session.Zero()
		return nil, nil, err
	}
	plaintext, err := aead.Open(nil, nonce, ciphertext, envelope.aad())
	if err != nil {
		session.Zero()
		return nil, nil, ErrWrongPassword
	}
	return session, plaintext, nil
}

func newSession(password string, salt []byte, p Params) *Session {
	derived := argon2.IDKey([]byte(password), salt, p.Time, p.MemoryKiB, p.Lanes, keySize)
	session := &Session{salt: salt, params: p}
	copy(session.key[:], derived)
	zero(derived)
	return session
}

// Seal encrypts the document under a fresh nonce.
func (s *Session) Seal(plaintext []byte) (string, error) {
	if s.locked {
		return "", ErrLocked
	}

	envelope := Envelope{
		V:    envelopeVersion,
		KDF:  kdfName,
		T:    s.params.Time,
		M:    s.params.MemoryKiB,
		P:    s.params.Lanes,
		Salt: base64.StdEncoding.EncodeToString(s.salt),
	}

	aead, err := chacha20poly1305.NewX(s.key[:])
	if err != nil {
		return "", err
	}
	nonce := make([]byte, nonceSize)
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	envelope.Nonce = base64.StdEncoding.EncodeToString(nonce)

	ciphertext := aead.Seal(nil, nonce, plaintext, envelope.aad())
	envelope.CT = base64.StdEncoding.EncodeToString(ciphertext)

	encoded, err := json.Marshal(envelope)
	if err != nil {
		return "", err
	}
	if len(encoded) > maxBlobBytes {
		return "", fmt.Errorf("%w: blob too large", ErrBadEnvelope)
	}
	return string(encoded), nil
}

// Params returns a copy of the session's KDF parameters.
func (s *Session) Params() Params {
	return s.params
}

// Zero wipes the key. Go's garbage collector may already have copied it, so
// this reduces exposure rather than eliminating it.
func (s *Session) Zero() {
	for i := range s.key {
		s.key[i] = 0
	}
	s.locked = true
}

func zero(b []byte) {
	for i := range b {
		b[i] = 0
	}
}
