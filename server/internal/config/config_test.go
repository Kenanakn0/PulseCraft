package config

import (
	"strings"
	"testing"
)

// Table-driven test: Go'da test senaryoları bir slice'ta toplanıp t.Run ile
// çalıştırılır — C#'taki xUnit [Theory] + [InlineData] karşılığı.
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
		// 32 bayt ama 16 karakter: bayt değil KARAKTER sayısı sayılır.
		{"16 karakter, 32 bayt", strings.Repeat("ğ", 16), true},
		// Baştaki/sondaki boşluklar sayılmaz.
		{"boşluklarla şişirilmiş", "  " + strings.Repeat("a", 20) + "  ", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// t.Setenv, test bitince eski değeri otomatik geri yükler.
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
