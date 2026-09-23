package config

import (
	"fmt"
	"os"
	"strings"
	"unicode/utf8"
)

// minJWTSecretLen: JWT imzalama anahtarının en az karakter sayısı.
const minJWTSecretLen = 32

// Config: server'ın çalışması için gereken tüm ayarlar.
type Config struct {
	ListenAddr  string
	DatabaseURL string
	RedisURL    string

	// JWTSecret: oturum token'larını imzalayan gizli anahtar. Varsayılanı YOKTUR:
	// tanımlı değilse veya kısaysa Load hata döner (fail-fast).
	JWTSecret string

	// DemoUsers: "e-posta:parola:görünen ad;..." biçiminde ham metin
	// (ayrıştırma auth.ParseDemoUsers'ta). Boş olabilir.
	DemoUsers string
}

// Load: ortam değişkenlerinden ayarları okur, verilmemişse varsayılan
// kullanır. DatabaseURL'in varsayılanı deploy/.env.example'daki değerlerle
// eşleşir — docker compose ile ayağa kaldırılan DB'ye ek ayar yapmadan
// bağlanabilmek için. Geçersiz konfigürasyonda hata döner; server bu durumda
// hiç başlamamalıdır.
func Load() (Config, error) {
	cfg := Config{
		ListenAddr:  envOrDefault("PULSECRAFT_LISTEN_ADDR", ":8080"),
		DatabaseURL: envOrDefault("DATABASE_URL", "postgres://pulsecraft:degistir_beni@localhost:5432/pulsecraft?sslmode=disable"),
		RedisURL:    envOrDefault("REDIS_URL", "redis://localhost:6379/0"),
		JWTSecret:   strings.TrimSpace(os.Getenv("JWT_SECRET")),
		DemoUsers:   os.Getenv("DEMO_USERS"),
	}

	// Hata mesajı sırrın kendisini ASLA içermez, sadece uzunluğunu söyler.
	if n := utf8.RuneCountInString(cfg.JWTSecret); n < minJWTSecretLen {
		return Config{}, fmt.Errorf("JWT_SECRET tanımlı değil veya çok kısa (%d karakter); en az %d karakter gerekli", n, minJWTSecretLen)
	}

	return cfg, nil
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
