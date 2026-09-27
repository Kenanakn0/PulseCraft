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

// utf8BOM: Windows Not Defteri gibi araçların dosya başına eklediği bayt sırası işareti (U+FEFF).
const utf8BOM = string(rune(0xFEFF))

// apiKeyLen: sunucunun ürettiği anahtarın uzunluğu (32 rastgele baytın onaltılık gösterimi).
const apiKeyLen = 64

// maxPromptAttempts: etkileşimli girişte geçersiz anahtar kaç kez yeniden sorulur.
const maxPromptAttempts = 3

// ErrNoAPIKey: hiçbir kaynaktan anahtar gelmedi ve soracak bir terminal de yok.
var ErrNoAPIKey = errors.New("API anahtarı verilmedi. Seçenekler: agent'ı bir terminalde çalıştırıp sorulduğunda " +
	"yapıştırın, -api-key-file ile bir dosyadan okutun ya da PULSECRAFT_API_KEY ortam değişkenini ayarlayın")

// ErrKeyFileIsDir: -api-key-file bir KLASÖRÜ gösteriyor. Tipik neden: Docker, bağlanacak dosya host'ta yokken
// onun yerine boş bir klasör oluşturur.
var ErrKeyFileIsDir = errors.New("dosya yerine bir KLASÖR var")

// KeyInput: anahtarın okunacağı dış dünya. Load gerçek terminali/dosya sistemini verir; testler sahtesini.
// (C#'ta bir IConsole / IFileSystem arayüzünü enjekte etmek gibi.)
type KeyInput struct {
	IsTerminal   func() bool                  // standart girdi bir terminal mi (etkileşimli soru sorulabilir mi)
	ReadPassword func() ([]byte, error)       // bir satırı EKRANA BASMADAN okur
	ReadFile     func(string) ([]byte, error) // -api-key-file için
	Prompt       io.Writer                    // soru ve uyarılar buraya (stderr) yazılır
}

// ResolveAPIKey: anahtarı sırasıyla (1) -api-key / PULSECRAFT_API_KEY, (2) -api-key-file /
// PULSECRAFT_API_KEY_FILE, (3) terminal varsa etkileşimli (gizli) giriş kaynağından alır ve doğrular.
// Döndürülen `source`, loglarda anahtarın NEREDEN geldiğini göstermek içindir (anahtarın kendisi asla loglanmaz).
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
			fmt.Fprintln(in.Prompt) // gizli girişte Enter satır atlatmaz
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

// NormalizeAPIKey: baştaki/sondaki boşlukları ve yeni satırları, dosya başındaki UTF-8 BOM'u kırpar, küçük harfe
// çevirir ve biçimi doğrular (64 onaltılık karakter). Hata mesajı anahtarı ASLA içermez; yalnızca uzunluğu ve
// olası nedeni söyler (panoda anahtar yerine bir komut kalması gibi).
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

// decodeKeyFile: dosya baytlarını metne çevirir. Windows PowerShell 5.1'de `"..." > dosya` ve `Out-File`
// varsayılan olarak UTF-16 (BOM'lu) yazar; UTF-8 sanıp okursak araya NUL baytları girer ve anahtar hiç
// eşleşmez. BOM'a bakıp UTF-16 LE/BE'yi çözer, aksi halde UTF-8 kabul eder (UTF-8 BOM'u NormalizeAPIKey kırpar).
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
