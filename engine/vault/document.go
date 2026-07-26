package vault

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

const documentVersion = 1

const (
	maxDocumentBytes = 1 << 20
	maxEntries       = 256
	maxIDLen         = 128
	maxNicknameLen   = 128
	maxHostLen       = 1024
	maxUsernameLen   = 256
	maxPasswordLen   = 4096
)

var (
	ErrInvalidEntry = errors.New("vault: invalid entry")
	ErrNoSuchEntry  = errors.New("vault: no such entry")
)

// Entry is a saved target. Username and Password are absent at the save levels
// that exclude them: the level is derived from which fields are set rather
// than stored, so no enum can disagree with the data.
type Entry struct {
	ID       string `json:"id"`
	Nickname string `json:"nickname"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username,omitempty"`
	Password string `json:"password,omitempty"`
}

// EntryUpdate is an upsert request. A nil Password keeps whatever is already
// saved; a non-nil empty Password clears it.
type EntryUpdate struct {
	ID       string
	Nickname string
	Host     string
	Port     int
	Username string
	Password *string
}

// RedactedEntry is the only entry shape that crosses into JavaScript.
type RedactedEntry struct {
	ID          string `json:"id"`
	Nickname    string `json:"nickname"`
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Username    string `json:"username,omitempty"`
	HasPassword bool   `json:"hasPassword"`
}

// Document is the vault plaintext. It exists only inside the ciphertext.
type Document struct {
	V       int     `json:"v"`
	Entries []Entry `json:"entries"`
}

func NewDocument() *Document {
	return &Document{V: documentVersion, Entries: []Entry{}}
}

func ParseDocument(plaintext []byte) (*Document, error) {
	if len(plaintext) > maxDocumentBytes {
		return nil, fmt.Errorf("vault: malformed document: too large")
	}
	var d Document
	decoder := json.NewDecoder(bytes.NewReader(plaintext))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&d); err != nil {
		return nil, fmt.Errorf("vault: malformed document: %w", err)
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return nil, fmt.Errorf("vault: malformed document: %w", err)
	}
	if d.V != documentVersion {
		return nil, fmt.Errorf("vault: unsupported document version %d", d.V)
	}
	if d.Entries == nil {
		d.Entries = []Entry{}
	}
	if len(d.Entries) > maxEntries {
		return nil, fmt.Errorf("vault: malformed document: too many entries")
	}
	ids := make(map[string]struct{}, len(d.Entries))
	for _, entry := range d.Entries {
		if err := validateEntry(entry); err != nil {
			return nil, fmt.Errorf("vault: malformed document: %w", err)
		}
		if _, exists := ids[entry.ID]; exists {
			return nil, fmt.Errorf("vault: malformed document: duplicate id")
		}
		ids[entry.ID] = struct{}{}
	}
	return &d, nil
}

func (d *Document) Marshal() ([]byte, error) {
	return json.Marshal(d)
}

func (d *Document) Clone() *Document {
	entries := make([]Entry, len(d.Entries))
	copy(entries, d.Entries)
	return &Document{V: d.V, Entries: entries}
}

func (d *Document) Upsert(u EntryUpdate) error {
	entry := Entry{
		ID:       strings.TrimSpace(u.ID),
		Nickname: strings.TrimSpace(u.Nickname),
		Host:     strings.TrimSpace(u.Host),
		Port:     u.Port,
		Username: strings.TrimSpace(u.Username),
	}

	switch {
	case entry.ID == "":
		return fmt.Errorf("%w: missing id", ErrInvalidEntry)
	case len(entry.ID) > maxIDLen:
		return fmt.Errorf("%w: id too long", ErrInvalidEntry)
	case entry.Nickname == "":
		return fmt.Errorf("%w: missing nickname", ErrInvalidEntry)
	case len(entry.Nickname) > maxNicknameLen:
		return fmt.Errorf("%w: nickname too long", ErrInvalidEntry)
	case entry.Host == "":
		return fmt.Errorf("%w: missing host", ErrInvalidEntry)
	case len(entry.Host) > maxHostLen:
		return fmt.Errorf("%w: host too long", ErrInvalidEntry)
	case entry.Port < 1 || entry.Port > 65535:
		return fmt.Errorf("%w: port out of range", ErrInvalidEntry)
	case len(entry.Username) > maxUsernameLen:
		return fmt.Errorf("%w: username too long", ErrInvalidEntry)
	case u.Password != nil && len(*u.Password) > maxPasswordLen:
		return fmt.Errorf("%w: password too long", ErrInvalidEntry)
	}

	existing := d.indexOf(entry.ID)

	switch {
	case u.Password != nil:
		entry.Password = *u.Password
	case existing >= 0:
		entry.Password = d.Entries[existing].Password
	}

	// A password without an account to use it on is dead weight, and leaving
	// one behind would silently keep a secret the user believes they removed.
	if entry.Username == "" {
		entry.Password = ""
	}

	if existing >= 0 {
		d.Entries[existing] = entry
		return nil
	}
	if len(d.Entries) >= maxEntries {
		return fmt.Errorf("%w: too many entries", ErrInvalidEntry)
	}
	d.Entries = append(d.Entries, entry)
	return nil
}

func validateEntry(entry Entry) error {
	password := entry.Password
	d := NewDocument()
	if err := d.Upsert(EntryUpdate{
		ID: entry.ID, Nickname: entry.Nickname, Host: entry.Host, Port: entry.Port,
		Username: entry.Username, Password: &password,
	}); err != nil {
		return err
	}
	if len(d.Entries) != 1 || d.Entries[0] != entry {
		return fmt.Errorf("%w: entry is not canonical", ErrInvalidEntry)
	}
	return nil
}

func (d *Document) Delete(id string) bool {
	at := d.indexOf(id)
	if at < 0 {
		return false
	}
	copy(d.Entries[at:], d.Entries[at+1:])
	last := len(d.Entries) - 1
	d.Entries[last] = Entry{}
	d.Entries = d.Entries[:last]
	return true
}

func (d *Document) Redacted() []RedactedEntry {
	redacted := make([]RedactedEntry, 0, len(d.Entries))
	for _, entry := range d.Entries {
		redacted = append(redacted, RedactedEntry{
			ID:          entry.ID,
			Nickname:    entry.Nickname,
			Host:        entry.Host,
			Port:        entry.Port,
			Username:    entry.Username,
			HasPassword: entry.Password != "",
		})
	}
	return redacted
}

func (d *Document) PasswordFor(id string) (string, bool) {
	at := d.indexOf(id)
	if at < 0 || d.Entries[at].Password == "" {
		return "", false
	}
	return d.Entries[at].Password, true
}

func (d *Document) indexOf(id string) int {
	for i, entry := range d.Entries {
		if entry.ID == id {
			return i
		}
	}
	return -1
}
