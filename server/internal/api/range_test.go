package api

import (
	"net/url"
	"testing"
	"time"
)

var fixedNow = time.Date(2030, 6, 15, 12, 0, 0, 0, time.UTC)

func query(t *testing.T, raw string) url.Values {
	t.Helper()
	q, err := url.ParseQuery(raw)
	if err != nil {
		t.Fatal(err)
	}
	return q
}

func TestResolveRange_Last(t *testing.T) {
	tests := []struct {
		raw  string
		span time.Duration
	}{
		{"last=15m", 15 * time.Minute},
		{"last=1h", time.Hour},
		{"last=6h", 6 * time.Hour},
		{"last=24h", 24 * time.Hour},
		{"last=1m", time.Minute},           // alt sınır dahil
		{"last=720h", 30 * 24 * time.Hour}, // üst sınır dahil
		{"last=90m", 90 * time.Minute},
	}
	for _, tt := range tests {
		from, to, err := resolveRange(query(t, tt.raw), fixedNow)
		if err != nil {
			t.Errorf("%s: beklenmeyen hata: %v", tt.raw, err)
			continue
		}
		// Pencere, verilen "şimdi"ye (sunucu saati) göre kurulur: tarayıcı saati hiçbir rol oynamaz.
		if !to.Equal(fixedNow) || !from.Equal(fixedNow.Add(-tt.span)) {
			t.Errorf("%s: aralık = %v .. %v, beklenen %v .. %v", tt.raw, from, to, fixedNow.Add(-tt.span), fixedNow)
		}
	}
}

func TestResolveRange_LastInvalid(t *testing.T) {
	for _, raw := range []string{
		"last=abc", "last=15", "last=30s", "last=0m", "last=-1h", "last=721h", "last=9999h",
		"last=1h&from=2030-06-15T10:00:00Z", // birlikte kullanılamaz
		"last=1h&to=2030-06-15T10:00:00Z",
	} {
		if from, to, err := resolveRange(query(t, raw), fixedNow); err == nil {
			t.Errorf("%s: hata beklenirken %v .. %v döndü", raw, from, to)
		}
	}
}

func TestResolveRange_FromTo(t *testing.T) {
	from, to, err := resolveRange(query(t, "from=2030-06-15T10:00:00Z&to=2030-06-15T11:00:00Z"), fixedNow)
	if err != nil || !from.Equal(time.Date(2030, 6, 15, 10, 0, 0, 0, time.UTC)) || !to.Equal(time.Date(2030, 6, 15, 11, 0, 0, 0, time.UTC)) {
		t.Errorf("from/to = %v .. %v, %v", from, to, err)
	}

	// Hiçbiri verilmezse son 1 saat.
	from, to, err = resolveRange(query(t, ""), fixedNow)
	if err != nil || !to.Equal(fixedNow) || !from.Equal(fixedNow.Add(-time.Hour)) {
		t.Errorf("varsayılan = %v .. %v, %v", from, to, err)
	}

	for _, raw := range []string{"from=dun", "to=yarin", "from=2030-06-15T11:00:00Z&to=2030-06-15T10:00:00Z", "from=2030-06-15T10:00:00Z&to=2030-06-15T10:00:00Z"} {
		if _, _, err := resolveRange(query(t, raw), fixedNow); err == nil {
			t.Errorf("%s: hata beklenirdi", raw)
		}
	}
}
