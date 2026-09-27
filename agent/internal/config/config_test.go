package config

import (
	"io"
	"strings"
	"testing"
	"time"
)

func env(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestParse_Defaults(t *testing.T) {
	cfg, err := parse(nil, env(nil), io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ServerURL != "http://localhost:8080" || cfg.Interval != 3*time.Second || cfg.APIKey != "" {
		t.Errorf("varsayılanlar yanlış: %+v", cfg)
	}
	if cfg.Hostname != "" {
		t.Errorf("hostname VARSAYILAN olarak gönderilmemeli, gelen: %q", cfg.Hostname)
	}
}

func TestParse_Hostname(t *testing.T) {
	tests := []struct {
		name string
		args []string
		env  map[string]string
		want string
	}{
		{"yalnızca bayrak", []string{"-hostname=demo-1"}, nil, "demo-1"},
		{"yalnızca ortam değişkeni", nil, map[string]string{"PULSECRAFT_HOSTNAME": "demo-2"}, "demo-2"},
		{"bayrak ortam değişkenini ezer", []string{"-hostname=bayrak"}, map[string]string{"PULSECRAFT_HOSTNAME": "ortam"}, "bayrak"},
		{"kenar boşlukları kırpılır", []string{"-hostname=  demo-3  "}, nil, "demo-3"},
		{"boş bayrak = gönderme", []string{"-hostname="}, map[string]string{"PULSECRAFT_HOSTNAME": "ortam"}, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := parse(tt.args, env(tt.env), io.Discard)
			if err != nil {
				t.Fatal(err)
			}
			if cfg.Hostname != tt.want {
				t.Errorf("Hostname = %q, beklenen %q", cfg.Hostname, tt.want)
			}
		})
	}
}

func TestParse_InvalidHostnameFailsFast(t *testing.T) {
	for name, h := range map[string]string{
		"çok uzun":   strings.Repeat("a", 254),
		"satır sonu": "web\n01",
		"NUL":        "web\x0001",
	} {
		var out strings.Builder
		_, err := parse([]string{"-hostname=" + h}, env(nil), &out)
		if err == nil {
			t.Errorf("%s: hata beklenirken kabul edildi", name)
		}
		if !strings.Contains(out.String(), "geçersiz -hostname") {
			t.Errorf("%s: kullanıcıya açıklayıcı mesaj yazılmalı, yazılan: %q", name, out.String())
		}
	}
}

func TestParse_OtherSettings(t *testing.T) {
	cfg, err := parse([]string{"-interval=1s", "-server=http://x:9"},
		env(map[string]string{"PULSECRAFT_API_KEY": "anahtar", "PULSECRAFT_INTERVAL": "10s"}), io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Interval != time.Second || cfg.ServerURL != "http://x:9" || cfg.APIKey != "anahtar" {
		t.Errorf("ayarlar yanlış: %+v", cfg)
	}
}
