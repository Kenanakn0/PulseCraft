package api

import (
	"strings"
	"testing"
)

func f(v float64) *float64 { return &v }

func TestIsOnline(t *testing.T) {
	tests := []struct {
		name string
		ago  *float64
		want bool
	}{
		{"hiç görülmedi", nil, false},
		{"az önce", f(0), true},
		{"3 sn (varsayılan agent aralığı)", f(3), true},
		{"tam eşik (15 sn)", f(15), true},
		{"eşiği biraz aştı", f(15.01), false},
		{"dakikalar önce", f(300), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isOnline(tt.ago); got != tt.want {
				t.Errorf("isOnline(%v) = %v, beklenen %v", tt.ago, got, tt.want)
			}
		})
	}
}

func TestNormalizeHostname(t *testing.T) {
	valid := []struct{ in, want string }{
		{"", ""},
		{"   ", ""},
		{"web-01", "web-01"},
		{"  web-01.example.test \t", "web-01.example.test"},
		{"Demo Sunucusu 1", "Demo Sunucusu 1"},
		{"sunucu-ğüşiöç", "sunucu-ğüşiöç"},
		{strings.Repeat("a", 253), strings.Repeat("a", 253)},
	}
	for _, tt := range valid {
		got, err := normalizeHostname(tt.in)
		if err != nil || got != tt.want {
			t.Errorf("normalizeHostname(%q) = %q, %v; beklenen %q", tt.in, got, err, tt.want)
		}
	}

	invalid := map[string]string{
		"çok uzun":       strings.Repeat("a", 254),
		"satır sonu":     "web\n01",
		"NUL":            "web\x0001",
		"sekme (ortada)": "web\t01",
		"geçersiz UTF-8": "web-\xff\xfe",
		"ESC (kontrol)":  "web\x1b[31m",
	}
	for name, in := range invalid {
		if got, err := normalizeHostname(in); err == nil {
			t.Errorf("%s: hata beklenirken %q döndü", name, got)
		}
	}
}
