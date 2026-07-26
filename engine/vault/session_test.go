package vault

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

// Tests use the minimum accepted stored cost. Production uses DefaultParams.
// Do not introduce a test-only weak cost into the parser: that is how security
// checks accidentally disappear from production.
var testParams = Params{Time: 1, MemoryKiB: 32 * 1024, Lanes: 1}

func TestSealOpenRoundTrip(t *testing.T) {
	session, err := Create("correct horse", testParams)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	defer session.Zero()

	blob, err := session.Seal([]byte(`{"v":1,"entries":[]}`))
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}

	reopened, plaintext, err := Unlock(blob, "correct horse")
	if err != nil {
		t.Fatalf("Unlock: %v", err)
	}
	defer reopened.Zero()

	if string(plaintext) != `{"v":1,"entries":[]}` {
		t.Fatalf("plaintext = %q", plaintext)
	}
}

func TestUnlockRejectsWrongPassword(t *testing.T) {
	session, err := Create("correct horse", testParams)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	defer session.Zero()

	blob, err := session.Seal([]byte("secret"))
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}

	if _, _, err := Unlock(blob, "wrong horse"); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("err = %v, want ErrWrongPassword", err)
	}
}

func TestUnlockRejectsTamperedCiphertext(t *testing.T) {
	session, _ := Create("pw", testParams)
	defer session.Zero()
	blob, _ := session.Seal([]byte("secret"))

	var envelope Envelope
	if err := json.Unmarshal([]byte(blob), &envelope); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	// Flip one base64 character in the ciphertext.
	flipped := "A"
	if strings.HasPrefix(envelope.CT, "A") {
		flipped = "B"
	}
	envelope.CT = flipped + envelope.CT[1:]
	tampered, _ := json.Marshal(envelope)

	if _, _, err := Unlock(string(tampered), "pw"); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("err = %v, want ErrWrongPassword", err)
	}
}

// The KDF parameters are authenticated, so an attacker cannot weaken a stored
// vault by rewriting the cost fields and letting it decrypt anyway.
func TestUnlockRejectsDowngradedParams(t *testing.T) {
	session, _ := Create("pw", Params{Time: 2, MemoryKiB: 64 * 1024, Lanes: 1})
	defer session.Zero()
	blob, _ := session.Seal([]byte("secret"))

	var envelope Envelope
	_ = json.Unmarshal([]byte(blob), &envelope)
	envelope.M = 32 * 1024
	envelope.T = 1
	downgraded, _ := json.Marshal(envelope)

	if _, _, err := Unlock(string(downgraded), "pw"); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("err = %v, want ErrWrongPassword", err)
	}
}

func TestRekeyInvalidatesTheOldPassword(t *testing.T) {
	session, _ := Create("old pw", testParams)
	defer session.Zero()
	blob, _ := session.Seal([]byte("secret"))

	reopened, _, err := Unlock(blob, "old pw")
	if err != nil {
		t.Fatalf("Unlock: %v", err)
	}
	defer reopened.Zero()

	next, err := Create("new pw", reopened.Params())
	if err != nil {
		t.Fatalf("Create replacement session: %v", err)
	}
	defer next.Zero()
	rekeyed, err := next.Seal([]byte("secret"))
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}

	if _, _, err := Unlock(rekeyed, "old pw"); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("old password still opens the vault: %v", err)
	}
	if _, _, err := Unlock(rekeyed, "new pw"); err != nil {
		t.Fatalf("new password does not open the vault: %v", err)
	}
}

func TestReplacementSessionUsesAFreshSalt(t *testing.T) {
	session, _ := Create("pw", testParams)
	defer session.Zero()
	before, _ := session.Seal([]byte("secret"))

	next, err := Create("pw", session.Params())
	if err != nil {
		t.Fatalf("Create replacement session: %v", err)
	}
	defer next.Zero()
	after, _ := next.Seal([]byte("secret"))

	var a, b Envelope
	_ = json.Unmarshal([]byte(before), &a)
	_ = json.Unmarshal([]byte(after), &b)
	if a.Salt == b.Salt {
		t.Fatal("Rekey reused the salt")
	}
}

func TestSealUsesAFreshNonce(t *testing.T) {
	session, _ := Create("pw", testParams)
	defer session.Zero()

	first, _ := session.Seal([]byte("secret"))
	second, _ := session.Seal([]byte("secret"))

	var a, b Envelope
	_ = json.Unmarshal([]byte(first), &a)
	_ = json.Unmarshal([]byte(second), &b)
	if a.Nonce == b.Nonce {
		t.Fatal("Seal reused the nonce")
	}
}

func TestSealRejectsEnvelopeTooLargeToUnlock(t *testing.T) {
	session, err := Create("password", testParams)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	if _, err := session.Seal(make([]byte, maxBlobBytes)); !errors.Is(err, ErrBadEnvelope) {
		t.Fatalf("Seal error = %v, want ErrBadEnvelope", err)
	}
}

func TestZeroWipesTheKey(t *testing.T) {
	session, _ := Create("pw", testParams)
	session.Zero()

	if _, err := session.Seal([]byte("secret")); !errors.Is(err, ErrLocked) {
		t.Fatalf("err = %v, want ErrLocked", err)
	}
	for _, b := range session.key {
		if b != 0 {
			t.Fatal("key bytes survived Zero")
		}
	}
}

func TestUnlockRejectsMalformedEnvelopes(t *testing.T) {
	cases := map[string]string{
		"not json":          "{{{",
		"unknown version":   `{"v":9,"kdf":"argon2id","t":1,"m":32768,"p":1,"salt":"AAAA","nonce":"AAAA","ct":"AAAA"}`,
		"unknown kdf":       `{"v":1,"kdf":"scrypt","t":1,"m":32768,"p":1,"salt":"AAAA","nonce":"AAAA","ct":"AAAA"}`,
		"unknown field":     `{"v":1,"kdf":"argon2id","t":1,"m":32768,"p":1,"salt":"AAAA","nonce":"AAAA","ct":"AAAA","extra":true}`,
		"bad base64 salt":   `{"v":1,"kdf":"argon2id","t":1,"m":32768,"p":1,"salt":"!!!","nonce":"AAAA","ct":"AAAA"}`,
		"short nonce":       `{"v":1,"kdf":"argon2id","t":1,"m":32768,"p":1,"salt":"AAAAAAAAAAAAAAAAAAAAAA==","nonce":"AAAA","ct":"AAAA"}`,
		"zero memory param": `{"v":1,"kdf":"argon2id","t":1,"m":0,"p":1,"salt":"AAAAAAAAAAAAAAAAAAAAAA==","nonce":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","ct":"AAAA"}`,
		"huge memory param": `{"v":1,"kdf":"argon2id","t":1,"m":4294967295,"p":1,"salt":"AAAAAAAAAAAAAAAAAAAAAA==","nonce":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","ct":"AAAA"}`,
		"huge time param":   `{"v":1,"kdf":"argon2id","t":4294967295,"m":32768,"p":1,"salt":"AAAAAAAAAAAAAAAAAAAAAA==","nonce":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","ct":"AAAA"}`,
	}

	for name, blob := range cases {
		t.Run(name, func(t *testing.T) {
			_, _, err := Unlock(blob, "pw")
			if err == nil {
				t.Fatal("want an error")
			}
			if errors.Is(err, ErrWrongPassword) {
				t.Fatalf("malformed input reported as a wrong password: %v", err)
			}
		})
	}
}
