package api

import (
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"
)

// maxHostnameBytes: DNS'in izin verdiği en uzun tam alan adı uzunluğu.
const maxHostnameBytes = 253

// normalizeHostname: agent'ın isteğe bağlı gönderdiği hostname'i temizler ve doğrular.
//
//   - Baş/sondaki boşluklar kırpılır; boş kalırsa ("", nil) döner ("değer yok").
//   - En fazla 253 bayt, geçerli UTF-8 olmalı, kontrol karakteri (satır sonu, sekme, NUL…)
//     içermemeli. Değer DB'ye yazılıp arayüzde gösterildiği için bilinçli olarak sıkıdır.
//
// Geçersizse hata döner; çağıran, ölçümleri reddetmeden hostname'i yok sayar
// (bozuk bir ayar metrik akışını durdurmasın).
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
