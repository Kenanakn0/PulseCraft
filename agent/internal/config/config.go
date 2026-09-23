package config

import (
	"flag"
	"os"
	"time"
)

// Config: agent'ın çalışması için gereken tüm ayarlar.
type Config struct {
	ServerURL string
	APIKey    string
	Interval  time.Duration
}

// Load: komut satırı bayraklarını (flag) ayrıştırır. Her bayrağın
// varsayılan değeri önce ilgili ortam değişkenine bakar; bu sayede ayar hem
// `-server ...` hem de PULSECRAFT_SERVER_URL ile yapılabilir. Flag açıkça
// verilirse flag kazanır — bu, Go'nun flag paketinin standart davranışıdır.
func Load() Config {
	serverURL := flag.String("server", envOrDefault("PULSECRAFT_SERVER_URL", "http://localhost:8080"), "Core server adresi")
	apiKey := flag.String("api-key", envOrDefault("PULSECRAFT_API_KEY", ""), "Node API key")
	interval := flag.Duration("interval", envDurationOrDefault("PULSECRAFT_INTERVAL", 3*time.Second), "Metrik toplama aralığı (ör. 3s, 500ms)")
	flag.Parse()

	return Config{
		ServerURL: *serverURL,
		APIKey:    *apiKey,
		Interval:  *interval,
	}
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envDurationOrDefault(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}
