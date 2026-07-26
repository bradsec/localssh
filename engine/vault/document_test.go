package vault

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func ptr(s string) *string { return &s }

func TestUpsertAddsAndUpdates(t *testing.T) {
	d := NewDocument()

	if err := d.Upsert(EntryUpdate{
		ID: "a", Nickname: "web", Host: "10.0.0.4", Port: 22,
		Username: "deploy", Password: ptr("hunter2"),
	}); err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	if len(d.Entries) != 1 {
		t.Fatalf("len(Entries) = %d, want 1", len(d.Entries))
	}

	if err := d.Upsert(EntryUpdate{
		ID: "a", Nickname: "web-prod", Host: "10.0.0.5", Port: 2222,
		Username: "deploy", Password: nil,
	}); err != nil {
		t.Fatalf("Upsert update: %v", err)
	}
	if len(d.Entries) != 1 {
		t.Fatalf("update appended instead of replacing: %d entries", len(d.Entries))
	}
	if d.Entries[0].Nickname != "web-prod" || d.Entries[0].Port != 2222 {
		t.Fatalf("entry not updated: %+v", d.Entries[0])
	}
}

// A nil Password means "leave the saved one alone", because the editor cannot
// display a password it never receives. An empty string means "clear it".
func TestUpsertKeepsPasswordWhenAbsent(t *testing.T) {
	d := NewDocument()
	_ = d.Upsert(EntryUpdate{ID: "a", Nickname: "web", Host: "h", Port: 22, Username: "u", Password: ptr("hunter2")})

	_ = d.Upsert(EntryUpdate{ID: "a", Nickname: "web", Host: "h", Port: 22, Username: "u", Password: nil})

	got, ok := d.PasswordFor("a")
	if !ok || got != "hunter2" {
		t.Fatalf("PasswordFor = %q, %v; want \"hunter2\", true", got, ok)
	}
}

func TestUpsertClearsPasswordWhenEmpty(t *testing.T) {
	d := NewDocument()
	_ = d.Upsert(EntryUpdate{ID: "a", Nickname: "web", Host: "h", Port: 22, Username: "u", Password: ptr("hunter2")})

	_ = d.Upsert(EntryUpdate{ID: "a", Nickname: "web", Host: "h", Port: 22, Username: "u", Password: ptr("")})

	if _, ok := d.PasswordFor("a"); ok {
		t.Fatal("password survived an explicit clear")
	}
}

// Dropping to "host only" must not leave an orphaned username behind.
func TestUpsertClearingUsernameAlsoClearsPassword(t *testing.T) {
	d := NewDocument()
	_ = d.Upsert(EntryUpdate{ID: "a", Nickname: "web", Host: "h", Port: 22, Username: "u", Password: ptr("hunter2")})

	_ = d.Upsert(EntryUpdate{ID: "a", Nickname: "web", Host: "h", Port: 22, Username: "", Password: nil})

	if d.Entries[0].Username != "" {
		t.Fatalf("Username = %q, want empty", d.Entries[0].Username)
	}
	if _, ok := d.PasswordFor("a"); ok {
		t.Fatal("a host-only entry kept a password")
	}
}

func TestUpsertValidates(t *testing.T) {
	cases := map[string]EntryUpdate{
		"no id":          {ID: "", Nickname: "n", Host: "h", Port: 22},
		"no nickname":    {ID: "a", Nickname: "", Host: "h", Port: 22},
		"blank nickname": {ID: "a", Nickname: "   ", Host: "h", Port: 22},
		"no host":        {ID: "a", Nickname: "n", Host: "", Port: 22},
		"port zero":      {ID: "a", Nickname: "n", Host: "h", Port: 0},
		"port too high":  {ID: "a", Nickname: "n", Host: "h", Port: 70000},
		"long nickname":  {ID: "a", Nickname: strings.Repeat("x", 129), Host: "h", Port: 22},
	}

	for name, update := range cases {
		t.Run(name, func(t *testing.T) {
			d := NewDocument()
			if err := d.Upsert(update); !errors.Is(err, ErrInvalidEntry) {
				t.Fatalf("err = %v, want ErrInvalidEntry", err)
			}
		})
	}
}

func TestUpsertTrimsWhitespace(t *testing.T) {
	d := NewDocument()
	_ = d.Upsert(EntryUpdate{ID: "a", Nickname: "  web  ", Host: "  10.0.0.4 ", Port: 22, Username: " deploy "})

	got := d.Entries[0]
	if got.Nickname != "web" || got.Host != "10.0.0.4" || got.Username != "deploy" {
		t.Fatalf("not trimmed: %+v", got)
	}
}

func TestDelete(t *testing.T) {
	d := NewDocument()
	password := "secret"
	_ = d.Upsert(EntryUpdate{ID: "a", Nickname: "n", Host: "h", Port: 22, Username: "u", Password: &password})
	_ = d.Upsert(EntryUpdate{ID: "b", Nickname: "n2", Host: "h2", Port: 22})

	if !d.Delete("a") {
		t.Fatal("Delete returned false for an existing entry")
	}
	if len(d.Entries) != 1 {
		t.Fatalf("len(Entries) = %d, want 1", len(d.Entries))
	}
	backing := d.Entries[:cap(d.Entries)]
	if backing[1] != (Entry{}) {
		t.Fatalf("vacated entry still contains data: %+v", backing[1])
	}
	if d.Delete("a") {
		t.Fatal("Delete returned true for a missing entry")
	}
}

// The redacted view is what crosses into JavaScript, so it must never carry a
// password field, not even an empty one.
func TestRedactedNeverCarriesAPassword(t *testing.T) {
	d := NewDocument()
	_ = d.Upsert(EntryUpdate{ID: "a", Nickname: "web", Host: "h", Port: 22, Username: "u", Password: ptr("hunter2")})
	_ = d.Upsert(EntryUpdate{ID: "b", Nickname: "nas", Host: "h2", Port: 22})

	encoded, err := json.Marshal(d.Redacted())
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	if strings.Contains(string(encoded), "hunter2") {
		t.Fatalf("redacted view leaked a password: %s", encoded)
	}
	if strings.Contains(strings.ToLower(string(encoded)), `"password"`) {
		t.Fatalf("redacted view carries a password field: %s", encoded)
	}

	redacted := d.Redacted()
	if !redacted[0].HasPassword {
		t.Fatal("entry a should report HasPassword")
	}
	if redacted[1].HasPassword {
		t.Fatal("entry b should not report HasPassword")
	}
}

func TestMarshalParseRoundTrip(t *testing.T) {
	d := NewDocument()
	_ = d.Upsert(EntryUpdate{ID: "a", Nickname: "web", Host: "h", Port: 22, Username: "u", Password: ptr("hunter2")})

	encoded, err := d.Marshal()
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	parsed, err := ParseDocument(encoded)
	if err != nil {
		t.Fatalf("ParseDocument: %v", err)
	}

	got, ok := parsed.PasswordFor("a")
	if !ok || got != "hunter2" {
		t.Fatalf("PasswordFor = %q, %v", got, ok)
	}
}

func TestParseDocumentRejectsJunk(t *testing.T) {
	if _, err := ParseDocument([]byte("{{{")); err == nil {
		t.Fatal("want an error for malformed JSON")
	}
	if _, err := ParseDocument([]byte(`{"v":9,"entries":[]}`)); err == nil {
		t.Fatal("want an error for an unknown document version")
	}
}
