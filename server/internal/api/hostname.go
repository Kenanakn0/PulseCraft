package api

import (
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"
)

// maxHostnameBytes is the longest fully qualified DNS name.
const maxHostnameBytes = 253

// normalizeHostname validates the optional hostname sent by the agent: trimmed (empty means no value),
// at most 253 bytes, valid UTF-8 and no control characters, because it is stored and shown in the UI.
// The caller ignores an invalid hostname instead of rejecting the samples, so a bad setting cannot stop
// the metric stream.
func normalizeHostname(raw string) (string, error) {
	h := strings.TrimSpace(raw)
	if h == "" {
		return "", nil
	}
	if len(h) > maxHostnameBytes {
		return "", errors.New("hostname çok uzun")
	}
	if !utf8.ValidString(h) {
		return "", errors.New("hostname geçerli UTF-8 değil")
	}
	for _, r := range h {
		if unicode.IsControl(r) {
			return "", errors.New("hostname kontrol karakteri içeriyor")
		}
	}
	return h, nil
}
