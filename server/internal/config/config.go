package config

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"unicode/utf8"
)

const minJWTSecretLen = 32

type Config struct {
	ListenAddr  string
	DatabaseURL string
	RedisURL    string

	// JWTSecret has no default: Load fails if it is missing or too short.
	JWTSecret string

	// DemoUsers is parsed by auth.ParseDemoUsers.
	DemoUsers string

	// CookieSecure must be true behind HTTPS; false for local HTTP development.
	CookieSecure bool

	// TrustedProxies is a comma-separated CIDR list (see clientip.ParseTrustedProxies). Empty trusts
	// no proxy.
	TrustedProxies string
}

// Load reads the settings from the environment. An invalid configuration returns an error and the server
// must not start.
func Load() (Config, error) {
	cfg := Config{
		ListenAddr:  envOrDefault("PULSECRAFT_LISTEN_ADDR", ":8080"),
		DatabaseURL: envOrDefault("DATABASE_URL", "postgres://pulsecraft@localhost:5432/pulsecraft?sslmode=disable"),
		RedisURL:    envOrDefault("REDIS_URL", "redis://localhost:6379/0"),
		JWTSecret:   strings.TrimSpace(os.Getenv("JWT_SECRET")),
		DemoUsers:   os.Getenv("DEMO_USERS"),

		TrustedProxies: os.Getenv("TRUSTED_PROXIES"),
	}

	// The error reports the length, never the secret.
	if n := utf8.RuneCountInString(cfg.JWTSecret); n < minJWTSecretLen {
		return Config{}, fmt.Errorf("JWT_SECRET tanımlı değil veya çok kısa (%d karakter); en az %d karakter gerekli", n, minJWTSecretLen)
	}

	if dbPasswordIsPlaceholder(cfg.DatabaseURL) {
		return Config{}, fmt.Errorf("DATABASE_URL: veritabanı parolası örnek dosyadaki yer tutucu; deploy/.env içinde POSTGRES_PASSWORD'ü değiştirin")
	}

	if v := strings.TrimSpace(os.Getenv("COOKIE_SECURE")); v != "" {
		secure, err := strconv.ParseBool(v)
		if err != nil {
			return Config{}, fmt.Errorf("COOKIE_SECURE geçersiz (true ya da false olmalı): %q", v)
		}
		cfg.CookieSecure = secure
	}

	return cfg, nil
}

// dbPasswordIsPlaceholder reports whether the database password is still the example value
// that older copies of .env.example shipped with.
func dbPasswordIsPlaceholder(databaseURL string) bool {
	u, err := url.Parse(databaseURL)
	if err != nil || u.User == nil {
		return false
	}
	pw, _ := u.User.Password()
	return strings.Contains(strings.ToLower(pw), "degistir")
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
