// Package vault seals the address book under a master password.
//
// The browser cannot help here: crypto.subtle is exposed only in secure
// contexts, and the documented LAN deployment is plain HTTP. Everything
// therefore runs in the WebAssembly engine, which reaches the platform CSPRNG
// through crypto/rand.
package vault

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"golang.org/x/crypto/chacha20poly1305"
)

// envelopeVersion is the on-disk format version. Bump it only for a change
// that older builds cannot read.
const envelopeVersion = 1

const kdfName = "argon2id"

const (
	minTime      = 1
	maxTime      = 10
	minMemoryKiB = 32 * 1024
	maxMemoryKiB = 256 * 1024
	minLanes     = 1
	maxLanes     = 4
	maxBlobBytes = 1 << 20
)

var (
	// ErrWrongPassword covers every authentication failure. A wrong password,
	// a flipped ciphertext byte, and a rewritten cost parameter are one case
	// deliberately: distinguishing them tells an attacker which part they got
	// right.
	ErrWrongPassword = errors.New("vault: wrong master password")

	ErrBadEnvelope        = errors.New("vault: malformed envelope")
	ErrUnsupportedVersion = errors.New("vault: unsupported envelope version")
	ErrLocked             = errors.New("vault: locked")
)

// Params are the Argon2id cost parameters. They travel with the envelope so
// that raising them later does not orphan an existing vault.
type Params struct {
	Time      uint32
	MemoryKiB uint32
	Lanes     uint8
}

// DefaultParams targets roughly half a second in WebAssembly on a mid-range
// phone. Task 4 measures this and lowers MemoryKiB if it runs long.
var DefaultParams = Params{Time: 3, MemoryKiB: 64 * 1024, Lanes: 1}

func (p Params) valid() bool {
	return p.Time >= minTime && p.Time <= maxTime &&
		p.MemoryKiB >= minMemoryKiB && p.MemoryKiB <= maxMemoryKiB &&
		p.Lanes >= minLanes && p.Lanes <= maxLanes
}

// Envelope is the stored form: JSON text whose binary fields are base64.
type Envelope struct {
	V     int    `json:"v"`
	KDF   string `json:"kdf"`
	T     uint32 `json:"t"`
	M     uint32 `json:"m"`
	P     uint8  `json:"p"`
	Salt  string `json:"salt"`
	Nonce string `json:"nonce"`
	CT    string `json:"ct"`
}

// aad is the associated data covering every field that is not the ciphertext
// or its nonce. Authenticating the cost parameters is what makes a downgrade
// fail loudly instead of decrypting under weaker settings.
func (e Envelope) aad() []byte {
	return []byte(fmt.Sprintf("v=%d|kdf=%s|t=%d|m=%d|p=%d|salt=%s",
		e.V, e.KDF, e.T, e.M, e.P, e.Salt))
}

func parseEnvelope(blob string) (Envelope, []byte, []byte, []byte, error) {
	if len(blob) > maxBlobBytes {
		return Envelope{}, nil, nil, nil, fmt.Errorf("%w: blob too large", ErrBadEnvelope)
	}
	var e Envelope
	decoder := json.NewDecoder(strings.NewReader(blob))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&e); err != nil {
		return e, nil, nil, nil, fmt.Errorf("%w: %v", ErrBadEnvelope, err)
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return e, nil, nil, nil, err
	}
	if e.V != envelopeVersion {
		return e, nil, nil, nil, fmt.Errorf("%w: %d", ErrUnsupportedVersion, e.V)
	}
	if e.KDF != kdfName {
		return e, nil, nil, nil, fmt.Errorf("%w: kdf %q", ErrBadEnvelope, e.KDF)
	}
	if !(Params{Time: e.T, MemoryKiB: e.M, Lanes: e.P}).valid() {
		return e, nil, nil, nil, fmt.Errorf("%w: cost parameters out of range", ErrBadEnvelope)
	}

	salt, err := base64.StdEncoding.DecodeString(e.Salt)
	if err != nil || len(salt) != saltSize {
		return e, nil, nil, nil, fmt.Errorf("%w: salt", ErrBadEnvelope)
	}
	nonce, err := base64.StdEncoding.DecodeString(e.Nonce)
	if err != nil || len(nonce) != nonceSize {
		return e, nil, nil, nil, fmt.Errorf("%w: nonce", ErrBadEnvelope)
	}
	ciphertext, err := base64.StdEncoding.DecodeString(e.CT)
	if err != nil || len(ciphertext) < chacha20poly1305.Overhead {
		return e, nil, nil, nil, fmt.Errorf("%w: ciphertext", ErrBadEnvelope)
	}
	return e, salt, nonce, ciphertext, nil
}

func ensureJSONEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return fmt.Errorf("%w: trailing JSON", ErrBadEnvelope)
	}
	return nil
}
