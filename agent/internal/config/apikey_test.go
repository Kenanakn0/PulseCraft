package config

import (
	"errors"
	"io"
	"os"
	"strings"
	"testing"
)

var validKey = strings.Repeat("ab", 32) // 64 onaltılık karakter

// fakeInput: gerçek terminal/dosya yerine kullanılan sahte girdi. passwords sırayla "yapıştırılan" satırlardır.
type fakeInput struct {
	terminal  bool
	passwords []string
	files     map[string]string
	prompt    strings.Builder
	reads     int
}

func (f *fakeInput) input() KeyInput {
	return KeyInput{
		IsTerminal: func() bool { return f.terminal },
		ReadPassword: func() ([]byte, error) {
			if f.reads >= len(f.passwords) {
				return nil, io.EOF
			}
			f.reads++
			return []byte(f.passwords[f.reads-1]), nil
		},
		ReadFile: func(name string) ([]byte, error) {
			if v, ok := f.files[name]; ok {
				return []byte(v), nil
			}
			return nil, os.ErrNotExist
		},
		Prompt: &f.prompt,
	}
}

func TestNormalizeAPIKey(t *testing.T) {
	ok := []struct{ name, raw string }{
		{"tam", validKey},
		{"sonda yeni satır (PowerShell dizisinin birleşmesi / dosya)", validKey + "\r\n"},
		{"sonda boşluk (Get-Clipboard dizisi env'e atanınca)", validKey + " "},
		{"başta boşluk", "  " + validKey},
		{"UTF-8 BOM (Not Defteri ile kaydedilmiş dosya)", "\uFEFF" + validKey + "\n"},
		{"büyük harf", strings.ToUpper(validKey)},
	}
	for _, tc := range ok {
		t.Run(tc.name, func(t *testing.T) {
			got, err := NormalizeAPIKey(tc.raw)
			if err != nil || got != validKey {
				t.Errorf("geçerli bekleniyordu: got=%q err=%v", got, err)
			}
		})
	}

	bad := []struct{ name, raw, want string }{
		{"boş", "", "boş"},
		{"yalnızca boşluk", " \r\n ", "boş"},
		{"panoda komut kalmış", "$env:PULSECRAFT_API_KEY = Get-Clipboard go run ./cmd/agent", "içinde boşluk"},
		{"eksik kopyalanmış", validKey[:40], "40 karakter"},
		{"onaltılık değil", strings.Repeat("zz", 32), "64 karakter geldi"},
	}
	for _, tc := range bad {
		t.Run(tc.name, func(t *testing.T) {
			_, err := NormalizeAPIKey(tc.raw)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("%q içeren hata bekleniyordu, gelen: %v", tc.want, err)
			}
			if trimmed := strings.TrimSpace(tc.raw); trimmed != "" && strings.Contains(err.Error(), trimmed) {
				t.Errorf("hata mesajı girilen değeri İÇERMEMELİ: %v", err)
			}
		})
	}
}

func TestResolveAPIKey_Sources(t *testing.T) {
	t.Run("bayrak/ortam değişkeni: kırpılır", func(t *testing.T) {
		f := &fakeInput{}
		v, src, err := ResolveAPIKey(validKey+" ", "", f.input())
		if err != nil || v != validKey || src != "bayrak/ortam değişkeni" {
			t.Fatalf("v=%q src=%q err=%v", v, src, err)
		}
	})

	t.Run("dosya: BOM ve CRLF kırpılır", func(t *testing.T) {
		f := &fakeInput{files: map[string]string{`C:\anahtar.txt`: "\uFEFF" + validKey + "\r\n"}}
		v, src, err := ResolveAPIKey("", `C:\anahtar.txt`, f.input())
		if err != nil || v != validKey || src != "dosya" {
			t.Fatalf("v=%q src=%q err=%v", v, src, err)
		}
	})

	t.Run("dosya: PowerShell 5.1'in UTF-16 LE (BOM'lu) yazdığı dosya çözülür", func(t *testing.T) {
		utf16le := []byte{0xFF, 0xFE}
		for _, r := range validKey + string(rune(13)) + string(rune(10)) {
			utf16le = append(utf16le, byte(r), 0)
		}
		f := &fakeInput{files: map[string]string{"k.txt": string(utf16le)}}
		v, _, err := ResolveAPIKey("", "k.txt", f.input())
		if err != nil || v != validKey {
			t.Fatalf("v=%q err=%v", v, err)
		}
	})

	t.Run("dosya: UTF-16 BE de çözülür", func(t *testing.T) {
		utf16be := []byte{0xFE, 0xFF}
		for _, r := range validKey {
			utf16be = append(utf16be, 0, byte(r))
		}
		f := &fakeInput{files: map[string]string{"k.txt": string(utf16be)}}
		if v, _, err := ResolveAPIKey("", "k.txt", f.input()); err != nil || v != validKey {
			t.Fatalf("v=%q err=%v", v, err)
		}
	})

	t.Run("dosya yok: yolu söyleyen hata", func(t *testing.T) {
		f := &fakeInput{}
		_, _, err := ResolveAPIKey("", `C:\yok.txt`, f.input())
		if err == nil || !strings.Contains(err.Error(), `C:\yok.txt`) || !strings.Contains(err.Error(), "bulunamadı") || !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("dosya bulunamadı hatası bekleniyordu: %v", err)
		}
	})

	t.Run("yol bir KLASÖR (Docker'ın boş klasör tuzağı): ne yapılacağını söyler", func(t *testing.T) {
		in := (&fakeInput{}).input()
		in.ReadFile = func(string) ([]byte, error) { return nil, ErrKeyFileIsDir }
		_, _, err := ResolveAPIKey("", "/run/secrets/demo-agent.key", in)
		if !errors.Is(err, ErrKeyFileIsDir) || !strings.Contains(err.Error(), "klasörü silip") {
			t.Fatalf("klasör hatası bekleniyordu: %v", err)
		}
	})

	t.Run("gerçek dosya sistemi: readKeyFile klasörü ayırt eder, dosyayı okur", func(t *testing.T) {
		dir := t.TempDir()
		if _, err := readKeyFile(dir); !errors.Is(err, ErrKeyFileIsDir) {
			t.Errorf("klasör için ErrKeyFileIsDir bekleniyordu: %v", err)
		}
		p := dir + "/k.key"
		if err := os.WriteFile(p, []byte(validKey+string(rune(10))), 0o600); err != nil {
			t.Fatal(err)
		}
		if b, err := readKeyFile(p); err != nil || strings.TrimSpace(string(b)) != validKey {
			t.Errorf("dosya okunamadı: %q %v", b, err)
		}
		if _, err := readKeyFile(dir + "/yok.key"); !errors.Is(err, os.ErrNotExist) {
			t.Errorf("olmayan dosya için ErrNotExist bekleniyordu: %v", err)
		}
	})

	t.Run("ikisi birden verilmişse hata", func(t *testing.T) {
		f := &fakeInput{}
		if _, _, err := ResolveAPIKey(validKey, "a.txt", f.input()); err == nil || !strings.Contains(err.Error(), "yalnızca birini") {
			t.Fatalf("hata bekleniyordu: %v", err)
		}
	})

	t.Run("hiçbiri yok ve terminal yok: yönlendiren hata", func(t *testing.T) {
		f := &fakeInput{terminal: false}
		if _, _, err := ResolveAPIKey("", "", f.input()); !errors.Is(err, ErrNoAPIKey) {
			t.Fatalf("ErrNoAPIKey bekleniyordu: %v", err)
		}
	})
}

func TestResolveAPIKey_Interactive(t *testing.T) {
	t.Run("terminalde gizlice sorar; anahtar çıktıya YAZILMAZ", func(t *testing.T) {
		f := &fakeInput{terminal: true, passwords: []string{validKey}}
		v, src, err := ResolveAPIKey("", "", f.input())
		if err != nil || v != validKey || src != "etkileşimli giriş" {
			t.Fatalf("v=%q src=%q err=%v", v, src, err)
		}
		out := f.prompt.String()
		if !strings.Contains(out, "ekranda görünmez") {
			t.Errorf("soru metni yok: %q", out)
		}
		if strings.Contains(out, validKey) {
			t.Errorf("anahtar ekrana yazılmamalı: %q", out)
		}
	})

	t.Run("geçersiz yapıştırılırsa nedenini söyleyip yeniden sorar", func(t *testing.T) {
		f := &fakeInput{terminal: true, passwords: []string{"go run ./cmd/agent", validKey}}
		v, _, err := ResolveAPIKey("", "", f.input())
		if err != nil || v != validKey || f.reads != 2 {
			t.Fatalf("ikinci denemede kabul bekleniyordu: v=%q err=%v reads=%d", v, err, f.reads)
		}
		if !strings.Contains(f.prompt.String(), "Geçersiz: anahtar geçersiz görünüyor") {
			t.Errorf("neden açıklanmadı: %q", f.prompt.String())
		}
	})

	t.Run("3 geçersiz denemeden sonra vazgeçer", func(t *testing.T) {
		f := &fakeInput{terminal: true, passwords: []string{"a", "b", "c", validKey}}
		if _, _, err := ResolveAPIKey("", "", f.input()); err == nil || f.reads != 3 {
			t.Fatalf("3 denemede hata bekleniyordu: err=%v reads=%d", err, f.reads)
		}
	})

	t.Run("okuma hatası (ör. Ctrl+Z/EOF) iletilir", func(t *testing.T) {
		f := &fakeInput{terminal: true}
		if _, _, err := ResolveAPIKey("", "", f.input()); err == nil || !errors.Is(err, io.EOF) {
			t.Fatalf("EOF hatası bekleniyordu: %v", err)
		}
	})

	t.Run("bayrak/dosya verilmişse terminal olsa da SORMAZ", func(t *testing.T) {
		f := &fakeInput{terminal: true, passwords: []string{"kullanılmamalı"}}
		if _, _, err := ResolveAPIKey(validKey, "", f.input()); err != nil || f.reads != 0 {
			t.Fatalf("sorulmamalıydı: err=%v reads=%d", err, f.reads)
		}
	})
}

func TestParse_APIKeyFlagWarnsButEnvDoesNot(t *testing.T) {
	var out strings.Builder
	if _, err := parse([]string{"-api-key=" + validKey}, env(nil), &out); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "UYARI: -api-key") {
		t.Errorf("komut satırındaki anahtar için uyarı bekleniyordu: %q", out.String())
	}
	if strings.Contains(out.String(), validKey) {
		t.Errorf("uyarı anahtarı içermemeli")
	}

	out.Reset()
	cfg, err := parse(nil, env(map[string]string{"PULSECRAFT_API_KEY": validKey, "PULSECRAFT_API_KEY_FILE": ""}), &out)
	if err != nil || cfg.APIKey != validKey || out.Len() != 0 {
		t.Errorf("ortam değişkeninde uyarı olmamalı: cfg=%+v out=%q err=%v", cfg, out.String(), err)
	}

	cfg, _ = parse([]string{"-api-key-file=C:/anahtar.txt"}, env(nil), io.Discard)
	if cfg.APIKeyFile != "C:/anahtar.txt" {
		t.Errorf("-api-key-file okunmadı: %+v", cfg)
	}
	cfg, _ = parse(nil, env(map[string]string{"PULSECRAFT_API_KEY_FILE": "/run/secrets/agent_key"}), io.Discard)
	if cfg.APIKeyFile != "/run/secrets/agent_key" {
		t.Errorf("PULSECRAFT_API_KEY_FILE okunmadı: %+v", cfg)
	}
}
