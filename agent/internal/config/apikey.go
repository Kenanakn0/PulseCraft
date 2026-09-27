package config

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"strings"
	"unicode/utf16"
)

const utf8BOM = string(rune(0xFEFF))

// apiKeyLen is the hex length of the server's 32-byte keys.
const apiKeyLen = 64

const maxPromptAttempts = 3

// ErrNoAPIKey: no key from any source and no terminal to ask on.
var ErrNoAPIKey = errors.New("API anahtarı verilmedi. Seçenekler: agent'ı bir terminalde çalıştırıp sorulduğunda " +
	"yapıştırın, -api-key-file ile bir dosyadan okutun ya da PULSECRAFT_API_KEY ortam değişkenini ayarlayın")

// ErrKeyFileIsDir: typically Docker created an empty directory because the bind-mounted file did not
// exist on the host.
var ErrKeyFileIsDir = errors.New("dosya yerine bir KLASÖR var")

// KeyInput abstracts the terminal and file system so that tests can fake them.
type KeyInput struct {
	IsTerminal   func() bool
	ReadPassword func() ([]byte, error) // reads a line without echoing it
	ReadFile     func(string) ([]byte, error)
	Prompt       io.Writer
}

// ResolveAPIKey takes the key from (1) -api-key / PULSECRAFT_API_KEY, (2) -api-key-file /
// PULSECRAFT_API_KEY_FILE, or (3) a hidden prompt when stdin is a terminal. source is only for logging;
// the key itself is never logged.
func ResolveAPIKey(key, file string, in KeyInput) (value, source string, err error) {
	switch {
	case key != "" && file != "":
		return "", "", errors.New("hem -api-key/PULSECRAFT_API_KEY hem -api-key-file/PULSECRAFT_API_KEY_FILE verilmiş; yalnızca birini kullanın")

	case key != "":
		v, err := NormalizeAPIKey(key)
		if err != nil {
			return "", "", fmt.Errorf("-api-key / PULSECRAFT_API_KEY: %w", err)
		}
		return v, "bayrak/ortam değişkeni", nil

	case file != "":
		raw, err := in.ReadFile(file)
		switch {
		case errors.Is(err, fs.ErrNotExist):
			return "", "", fmt.Errorf("anahtar dosyası bulunamadı (%s): arayüzdeki anahtarı bu dosyaya kaydedin: %w", file, err)
		case errors.Is(err, ErrKeyFileIsDir):
			return "", "", fmt.Errorf("anahtar dosyası (%s): %w. Docker bağlanacak dosya yoksa boş klasör oluşturur; "+
				"klasörü silip anahtarı dosya olarak kaydedin: %w", file, ErrKeyFileIsDir, fs.ErrInvalid)
		case err != nil:
			return "", "", fmt.Errorf("anahtar dosyası okunamadı (%s): %w", file, err)
		}
		v, err := NormalizeAPIKey(decodeKeyFile(raw))
		if err != nil {
			return "", "", fmt.Errorf("anahtar dosyası (%s): %w", file, err)
		}
		return v, "dosya", nil

	case in.IsTerminal():
		for attempt := 1; attempt <= maxPromptAttempts; attempt++ {
			fmt.Fprint(in.Prompt, "API anahtarını yapıştırıp Enter'a basın (ekranda görünmez): ")
			raw, err := in.ReadPassword()
			fmt.Fprintln(in.Prompt) // Enter does not produce a newline with hidden input
			if err != nil {
				return "", "", fmt.Errorf("anahtar okunamadı: %w", err)
			}
			v, err := NormalizeAPIKey(string(raw))
			if err == nil {
				return v, "etkileşimli giriş", nil
			}
			fmt.Fprintf(in.Prompt, "Geçersiz: %v\n", err)
		}
		return "", "", fmt.Errorf("%d denemede geçerli bir API anahtarı girilmedi", maxPromptAttempts)

	default:
		return "", "", ErrNoAPIKey
	}
}

// NormalizeAPIKey trims whitespace and a UTF-8 BOM, lower-cases and validates the key. Errors never
// contain the key, only its length and a likely cause (e.g. a copied command instead of the key).
func NormalizeAPIKey(raw string) (string, error) {
	v := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(raw, utf8BOM)))
	if v == "" {
		return "", errors.New("anahtar boş")
	}
	if len(v) == apiKeyLen && isHex(v) {
		return v, nil
	}
	hint := ""
	if strings.ContainsAny(v, " \t\r\n") {
		hint = " ve içinde boşluk/satır var"
	}
	return "", fmt.Errorf("anahtar geçersiz görünüyor: %d karakterlik onaltılık (0-9, a-f) bir değer bekleniyordu, "+
		"%d karakter geldi%s. Yanlış bir şey (ör. bir komut) kopyalanmış olabilir; arayüzdeki \"Kopyala\" ile yeniden deneyin",
		apiKeyLen, len([]rune(v)), hint)
}

// decodeKeyFile handles UTF-16 files: Windows PowerShell 5.1 writes UTF-16 with a BOM by default
// (`>` and Out-File), and reading that as UTF-8 would never match.
func decodeKeyFile(b []byte) string {
	var order binary.ByteOrder
	switch {
	case len(b) >= 2 && b[0] == 0xFF && b[1] == 0xFE:
		order = binary.LittleEndian
	case len(b) >= 2 && b[0] == 0xFE && b[1] == 0xFF:
		order = binary.BigEndian
	default:
		return string(b)
	}
	b = b[2:]
	units := make([]uint16, 0, len(b)/2)
	for i := 0; i+1 < len(b); i += 2 {
		units = append(units, order.Uint16(b[i:]))
	}
	return string(utf16.Decode(units))
}

func isHex(s string) bool {
	for _, r := range s {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return false
		}
	}
	return true
}
