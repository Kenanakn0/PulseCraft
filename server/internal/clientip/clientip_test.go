package clientip

import (
	"net/http"
	"net/netip"
	"testing"
)

func mustParse(t *testing.T, csv string) *Resolver {
	t.Helper()
	prefixes, err := ParseTrustedProxies(csv)
	if err != nil {
		t.Fatal(err)
	}
	return New(prefixes)
}

func TestClientIP(t *testing.T) {
	tests := []struct {
		name    string
		trusted string
		remote  string
		xff     []string // each element is a separate X-Forwarded-For header
		want    string
	}{
		{"güvenilir proxy yok, başlık yok sayılır", "", "203.0.113.9:4000", []string{"1.2.3.4"}, "203.0.113.9"},
		{"güvenilmeyen eş sahte başlık gönderiyor", "10.0.0.0/8", "203.0.113.9:4000", []string{"1.2.3.4"}, "203.0.113.9"},
		{"güvenilir proxy, tek istemci", "10.0.0.0/8", "10.1.1.1:4000", []string{"198.51.100.7"}, "198.51.100.7"},
		{"güvenilir proxy, başlık yok", "10.0.0.0/8", "10.1.1.1:4000", nil, "10.1.1.1"},
		{
			"istemci sahte adres ekledi: sağdaki gerçek olan alınır, soldaki uydurma yok sayılır",
			"10.0.0.0/8", "10.1.1.1:4000", []string{"1.2.3.4, 198.51.100.7"}, "198.51.100.7",
		},
		{
			"iç içe güvenilir proxy'ler atlanır",
			"10.0.0.0/8", "10.1.1.1:4000", []string{"198.51.100.7, 10.2.2.2, 10.3.3.3"}, "198.51.100.7",
		},
		{
			"birden çok başlık satırı birleştirilir",
			"10.0.0.0/8", "10.1.1.1:4000", []string{"1.2.3.4", "198.51.100.7, 10.2.2.2"}, "198.51.100.7",
		},
		{"bozuk değer: son geçerli hop", "10.0.0.0/8", "10.1.1.1:4000", []string{"198.51.100.7, bozuk"}, "10.1.1.1"},
		{"hepsi güvenilir: en soldaki güvenilir hop", "10.0.0.0/8", "10.1.1.1:4000", []string{"10.5.5.5, 10.6.6.6"}, "10.5.5.5"},
		{"IPv6 güvenilir proxy", "::1/128", "[::1]:4000", []string{"2001:db8::7"}, "2001:db8::7"},
		{"IPv4-mapped IPv6 eş güvenilir IPv4 aralığıyla eşleşir", "10.0.0.0/8", "[::ffff:10.1.1.1]:4000", []string{"198.51.100.7"}, "198.51.100.7"},
		{"tek IP güvenilir sayılır", "10.1.1.1", "10.1.1.1:4000", []string{"198.51.100.7"}, "198.51.100.7"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := mustParse(t, tt.trusted)
			req := &http.Request{RemoteAddr: tt.remote, Header: http.Header{}}
			for _, v := range tt.xff {
				req.Header.Add("X-Forwarded-For", v)
			}

			got := r.ClientIP(req)
			if got != netip.MustParseAddr(tt.want) {
				t.Errorf("ClientIP() = %v, beklenen %v", got, tt.want)
			}
		})
	}
}

func TestParseTrustedProxies(t *testing.T) {
	valid := []struct {
		csv  string
		want int
	}{
		{"", 0},
		{" , ,", 0},
		{"10.0.0.0/8", 1},
		{"10.0.0.0/8, ::1/128 ,192.168.1.5", 3},
	}
	for _, tt := range valid {
		got, err := ParseTrustedProxies(tt.csv)
		if err != nil || len(got) != tt.want {
			t.Errorf("ParseTrustedProxies(%q) = %v, %v; beklenen %d kayıt", tt.csv, got, err, tt.want)
		}
	}

	for _, csv := range []string{"10.0.0.0/33", "abc", "10.0.0.0/8, nope", "300.1.1.1"} {
		if _, err := ParseTrustedProxies(csv); err == nil {
			t.Errorf("ParseTrustedProxies(%q) hata dönmeliydi", csv)
		}
	}
}
