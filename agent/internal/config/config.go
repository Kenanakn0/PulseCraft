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

	"golang.org/x/term"
)

// maxHostnameBytes is the longest fully qualified DNS name; the server enforces the same limit.
const maxHostnameBytes = 253

type Config struct {
	ServerURL string
	// APIKey holds the raw flag/env value after parsing; Load replaces it with the resolved and
	// validated key.
	APIKey     string
	APIKeyFile string
	// APIKeySource tells where the key came from, for logging (the key is never logged).
	APIKeySource string
	Interval     time.Duration

	// Hostname is empty by default and then not sent at all. The agent never reads the machine name on
	// its own, so that a personal computer name cannot leak into screenshots or demos.
	Hostname string
}

// Load reads flags with environment variables as defaults, so every setting works either way; an
// explicit flag wins. On invalid settings it prints the reason to stderr and exits with code 2.
func Load() Config {
	cfg, err := parse(os.Args[1:], os.Getenv, os.Stderr)
	if err != nil {
		if errors.Is(err, flag.ErrHelp) {
			os.Exit(0)
		}
		os.Exit(2)
	}

	stdin := int(os.Stdin.Fd())
	key, source, err := ResolveAPIKey(cfg.APIKey, cfg.APIKeyFile, KeyInput{
		IsTerminal:   func() bool { return term.IsTerminal(stdin) },
		ReadPassword: func() ([]byte, error) { return term.ReadPassword(stdin) },
		ReadFile:     readKeyFile,
		Prompt:       os.Stderr,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "HATA:", err)
		os.Exit(2)
	}
	cfg.APIKey, cfg.APIKeySource = key, source
	return cfg
}

// readKeyFile reports a directory as ErrKeyFileIsDir instead of the platform-specific
// "is a directory" / "Access is denied" error.
func readKeyFile(path string) ([]byte, error) {
	if fi, err := os.Stat(path); err == nil && fi.IsDir() {
		return nil, ErrKeyFileIsDir
	}
	return os.ReadFile(path)
}

// parse is the testable core of Load: its own FlagSet and an injected getenv.
func parse(args []string, getenv func(string) string, out io.Writer) (Config, error) {
	fs := flag.NewFlagSet("agent", flag.ContinueOnError)
	fs.SetOutput(out)

	serverURL := fs.String("server", envOrDefault(getenv, "PULSECRAFT_SERVER_URL", "http://localhost:8080"), "Core server adresi")
	apiKey := fs.String("api-key", envOrDefault(getenv, "PULSECRAFT_API_KEY", ""),
		"Node API anahtarı (ÖNERİLMEZ: komut geçmişinde ve süreç listesinde görünür; verilmezse agent terminalde gizlice sorar)")
	apiKeyFile := fs.String("api-key-file", envOrDefault(getenv, "PULSECRAFT_API_KEY_FILE", ""),
		"API anahtarını içeren dosya (servis/container kullanımı için)")
	interval := fs.Duration("interval", envDurationOrDefault(getenv, "PULSECRAFT_INTERVAL", 3*time.Second), "Metrik toplama aralığı (ör. 3s, 500ms)")
	hostname := fs.String("hostname", envOrDefault(getenv, "PULSECRAFT_HOSTNAME", ""),
		"Sunucuda görünecek ad (isteğe bağlı; verilmezse hiçbir ad gönderilmez)")

	if err := fs.Parse(args); err != nil {
		return Config{}, err
	}

	// Warn only when the key came from the command line (it ends up in shell history).
	fs.Visit(func(f *flag.Flag) {
		if f.Name == "api-key" {
			fmt.Fprintln(out, "UYARI: -api-key ile verilen anahtar komut geçmişinde ve süreç listesinde görünür; "+
				"-api-key-file ya da etkileşimli girişi (bayrağı hiç vermeyin) tercih edin.")
		}
	})

	host, err := NormalizeHostname(*hostname)
	if err != nil {
		fmt.Fprintf(out, "geçersiz -hostname / PULSECRAFT_HOSTNAME: %v\n", err)
		return Config{}, err
	}

	return Config{
		ServerURL:  *serverURL,
		APIKey:     *apiKey,
		APIKeyFile: *apiKeyFile,
		Interval:   *interval,
		Hostname:   host,
	}, nil
}

// NormalizeHostname applies the server's rules so that a bad value fails at agent startup instead of
// being silently ignored by the server.
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
