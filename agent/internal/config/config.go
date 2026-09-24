package config

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// maxHostnameBytes: sunucunun kabul ettiği en uzun hostname (DNS tam alan adı sınırı).
const maxHostnameBytes = 253

// Config: agent'ın çalışması için gereken tüm ayarlar.
type Config struct {
	ServerURL string
	APIKey    string
	Interval  time.Duration

	// Hostname: sunucuya gönderilecek görünen ad. VARSAYILAN BOŞTUR ve boşsa hiç
	// gönderilmez. Agent gerçek bilgisayar adını (os.Hostname) KENDİLİĞİNDEN OKUMAZ
	// ve göndermez: ekran görüntüsüne/demoya kişisel bilgisayar adı sızmasın diye
	// yalnızca -hostname / PULSECRAFT_HOSTNAME ile açıkça verilirse gönderilir.
	Hostname string
}

// Load: komut satırı bayraklarını (flag) ve ortam değişkenlerini okur. Her bayrağın
// varsayılan değeri önce ilgili ortam değişkenine bakar; bu sayede ayar hem
// `-server ...` hem de PULSECRAFT_SERVER_URL ile yapılabilir. Flag açıkça
// verilirse flag kazanır — bu, Go'nun flag paketinin standart davranışıdır.
// Geçersiz ayarda mesajı stderr'e yazıp 2 koduyla çıkar (flag.ExitOnError davranışı).
func Load() Config {
	cfg, err := parse(os.Args[1:], os.Getenv, os.Stderr)
	if err != nil {
		if errors.Is(err, flag.ErrHelp) {
			os.Exit(0)
		}
		os.Exit(2)
	}
	return cfg
}

// parse: Load'un test edilebilir çekirdeği. Global flag.CommandLine yerine kendi
// FlagSet'ini kullanır (C#'ta statik bir yapılandırma nesnesi yerine enjekte edilebilir
// bir nesne kullanmak gibi) ve ortamı getenv fonksiyonuyla alır.
func parse(args []string, getenv func(string) string, out io.Writer) (Config, error) {
	fs := flag.NewFlagSet("agent", flag.ContinueOnError)
	fs.SetOutput(out)

	serverURL := fs.String("server", envOrDefault(getenv, "PULSECRAFT_SERVER_URL", "http://localhost:8080"), "Core server adresi")
	apiKey := fs.String("api-key", envOrDefault(getenv, "PULSECRAFT_API_KEY", ""), "Node API key")
	interval := fs.Duration("interval", envDurationOrDefault(getenv, "PULSECRAFT_INTERVAL", 3*time.Second), "Metrik toplama aralığı (ör. 3s, 500ms)")
	hostname := fs.String("hostname", envOrDefault(getenv, "PULSECRAFT_HOSTNAME", ""),
		"Sunucuda görünecek ad (isteğe bağlı; verilmezse hiçbir ad gönderilmez)")

	if err := fs.Parse(args); err != nil {
		return Config{}, err
	}

	host, err := NormalizeHostname(*hostname)
	if err != nil {
		fmt.Fprintf(out, "geçersiz -hostname / PULSECRAFT_HOSTNAME: %v\n", err)
		return Config{}, err
	}

	return Config{
		ServerURL: *serverURL,
		APIKey:    *apiKey,
		Interval:  *interval,
		Hostname:  host,
	}, nil
}

// NormalizeHostname: baş/sondaki boşlukları kırpar; boş kalırsa "" (gönderilmez) döner.
// En fazla 253 bayt, geçerli UTF-8 ve kontrol karakteri içermemeli. Kurallar sunucudakiyle
// aynıdır; böylece hatalı bir ayar, sunucuda sessizce yok sayılmak yerine agent
// açılırken hemen görülür.
func NormalizeHostname(raw string) (string, error) {
	h := strings.TrimSpace(raw)
	if h == "" {
		return "", nil
	}
	if len(h) > maxHostnameBytes {
		return "", fmt.Errorf("en fazla %d bayt olabilir", maxHostnameBytes)
	}
	if !utf8.ValidString(h) {
		return "", errors.New("geçerli UTF-8 değil")
	}
	for _, r := range h {
		if unicode.IsControl(r) {
			return "", errors.New("kontrol karakteri içeremez")
		}
	}
	return h, nil
}

func envOrDefault(getenv func(string) string, key, fallback string) string {
	if v := getenv(key); v != "" {
		return v
	}
	return fallback
}

func envDurationOrDefault(getenv func(string) string, key string, fallback time.Duration) time.Duration {
	if v := getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}
