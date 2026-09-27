package config

import (
	"strings"
	"testing"
)

func TestLoad_JWTSecret(t *testing.T) {
	tests := []struct {
		name    string
		secret  string
		wantErr bool
	}{
		{"tanımsız", "", true},
		{"sadece boşluk", strings.Repeat(" ", 40), true},
		{"31 karakter", strings.Repeat("a", 31), true},
		{"tam 32 karakter", strings.Repeat("a", 32), false},
		{"uzun", strings.Repeat("a", 64), false},
		// 32 bytes but 16 characters: characters are counted, not bytes.
		{"16 karakter, 32 bayt", strings.Repeat("ğ", 16), true},
		// Surrounding whitespace does not count.
		{"boşluklarla şişirilmiş", "  " + strings.Repeat("a", 20) + "  ", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("JWT_SECRET", tt.secret)

			cfg, err := Load()
			if (err != nil) != tt.wantErr {
				t.Fatalf("Load() hata = %v, hata beklenen = %v", err, tt.wantErr)
			}
			if trimmed := strings.TrimSpace(tt.secret); err != nil && trimmed != "" && strings.Contains(err.Error(), trimmed) {
				t.Errorf("hata mesajı sırrın kendisini içeriyor: %q", err)
			}
			if err == nil && cfg.JWTSecret != strings.TrimSpace(tt.secret) {
				t.Errorf("JWTSecret = %q, beklenen %q", cfg.JWTSecret, strings.TrimSpace(tt.secret))
			}
		})
	}
}

func TestLoad_CookieSecure(t *testing.T) {
	tests := []struct {
		value   string
		want    bool
		wantErr bool
	}{
		{"", false, false},
		{"false", false, false},
		{"true", true, false},
		{" TRUE ", true, false},
		{"1", true, false},
		{"evet", false, true},
	}
	for _, tt := range tests {
		t.Run(tt.value, func(t *testing.T) {
			t.Setenv("JWT_SECRET", strings.Repeat("s", 32))
			t.Setenv("COOKIE_SECURE", tt.value)

			cfg, err := Load()
			if (err != nil) != tt.wantErr {
				t.Fatalf("Load() hata = %v, hata beklenen = %v", err, tt.wantErr)
			}
			if err == nil && cfg.CookieSecure != tt.want {
				t.Errorf("CookieSecure = %v, beklenen %v", cfg.CookieSecure, tt.want)
			}
		})
	}
}

func TestLoad_Defaults(t *testing.T) {
	t.Setenv("JWT_SECRET", strings.Repeat("s", 32))
	t.Setenv("PULSECRAFT_LISTEN_ADDR", "")
	t.Setenv("REDIS_URL", "")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ListenAddr != ":8080" {
		t.Errorf("ListenAddr = %q, beklenen :8080", cfg.ListenAddr)
	}
	if cfg.RedisURL != "redis://localhost:6379/0" {
		t.Errorf("RedisURL = %q", cfg.RedisURL)
	}
}

func TestLoad_DatabasePasswordPlaceholder(t *testing.T) {
	tests := []struct {
		name    string
		url     string
		wantErr bool
	}{
		{"example placeholder", "postgres://pulsecraft:degistir_beni@db:5432/pulsecraft", true},
		{"placeholder, different case", "postgres://pulsecraft:DEGISTIR_beni_2@db:5432/pulsecraft", true},
		{"real password", "postgres://pulsecraft:0f3c9a1e7b2d@db:5432/pulsecraft", false},
		{"no password", "postgres://pulsecraft@localhost:5432/pulsecraft", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("JWT_SECRET", strings.Repeat("s", 32))
			t.Setenv("DATABASE_URL", tt.url)

			_, err := Load()
			if (err != nil) != tt.wantErr {
				t.Fatalf("Load() hata = %v, hata beklenen = %v", err, tt.wantErr)
			}
			if err != nil && strings.Contains(strings.ToLower(err.Error()), "degistir_beni") {
				t.Errorf("hata mesajı parolayı içeriyor: %q", err)
			}
		})
	}
}

func TestLoad_DefaultDatabaseURLHasNoPlaceholderPassword(t *testing.T) {
	t.Setenv("JWT_SECRET", strings.Repeat("s", 32))
	t.Setenv("DATABASE_URL", "")
	if _, err := Load(); err != nil {
		t.Fatalf("varsayılan DATABASE_URL ile Load() başarısız: %v", err)
	}
}
