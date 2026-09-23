package config

import "os"

// Config: server'ın çalışması için gereken tüm ayarlar.
type Config struct {
	ListenAddr  string
	DatabaseURL string
	RedisURL    string
}

// Load: ortam değişkenlerinden ayarları okur, verilmemişse varsayılan
// kullanır. DatabaseURL'in varsayılanı deploy/.env.example'daki değerlerle
// eşleşir — docker compose ile ayağa kaldırılan DB'ye ek ayar yapmadan
// bağlanabilmek için.
func Load() Config {
	return Config{
		ListenAddr:  envOrDefault("PULSECRAFT_LISTEN_ADDR", ":8080"),
		DatabaseURL: envOrDefault("DATABASE_URL", "postgres://pulsecraft:degistir_beni@localhost:5432/pulsecraft?sslmode=disable"),
		RedisURL:    envOrDefault("REDIS_URL", "redis://localhost:6379/0"),
	}
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
