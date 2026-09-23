package auth

import (
	"net/netip"
	"testing"
	"time"
)

// fakeClock: testte zamanı elle ilerletmek için.
type fakeClock struct{ t time.Time }

func (c *fakeClock) now() time.Time          { return c.t }
func (c *fakeClock) advance(d time.Duration) { c.t = c.t.Add(d) }

func newTestLimiter(limit int) (*RateLimiter, *fakeClock) {
	clock := &fakeClock{t: time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)}
	l := NewRateLimiter(limit, time.Minute)
	l.now = clock.now
	return l, clock
}

func TestRateLimiter_LimitAndSlidingWindow(t *testing.T) {
	l, clock := newTestLimiter(10)

	for i := 1; i <= 10; i++ {
		if ok, _ := l.Allow("1.2.3.4"); !ok {
			t.Fatalf("%d. deneme izinli olmalıydı", i)
		}
		clock.advance(time.Second) // denemeler 1 sn arayla: t=0..9
	}

	// 11. deneme (t=10 sn) reddedilmeli; ilk deneme t=0'da yapıldı, 60 sn'de düşer.
	ok, retry := l.Allow("1.2.3.4")
	if ok {
		t.Fatal("11. deneme reddedilmeliydi")
	}
	if retry != 50*time.Second {
		t.Errorf("retryAfter = %v, beklenen 50s", retry)
	}

	// Reddedilen deneme kaydedilmez: 50 sn sonra (t=60) ilk kayıt pencereden düşer.
	clock.advance(50 * time.Second)
	if ok, _ := l.Allow("1.2.3.4"); !ok {
		t.Error("pencere kaydıktan sonra bir deneme izinli olmalı")
	}
	// Ama 1 sn'de eski kayıtlar hâlâ pencerede: hemen ardından tekrar reddedilir.
	if ok, _ := l.Allow("1.2.3.4"); ok {
		t.Error("kayan pencerede yalnızca tek slot açılmıştı")
	}
}

func TestRateLimiter_KeysAreIndependent(t *testing.T) {
	l, _ := newTestLimiter(2)

	l.Allow("a")
	l.Allow("a")
	if ok, _ := l.Allow("a"); ok {
		t.Error("a limitini aşmalı")
	}
	if ok, _ := l.Allow("b"); !ok {
		t.Error("b, a'dan etkilenmemeli")
	}
}

func TestRateLimiter_Cleanup(t *testing.T) {
	l, clock := newTestLimiter(5)
	l.Allow("a")
	l.Allow("b")

	clock.advance(30 * time.Second)
	l.Allow("b")                    // b hâlâ etkin
	clock.advance(45 * time.Second) // a'nın kaydı 75 sn önce, b'nin son kaydı 45 sn önce

	l.Cleanup()
	if _, ok := l.hits["a"]; ok {
		t.Error("boştaki a anahtarı silinmeliydi")
	}
	if _, ok := l.hits["b"]; !ok {
		t.Error("etkin b anahtarı korunmalıydı")
	}
}

func TestRateLimiter_MaxKeys(t *testing.T) {
	l, _ := newTestLimiter(5)
	l.maxKeys = 3

	for _, k := range []string{"a", "b", "c"} {
		if ok, _ := l.Allow(k); !ok {
			t.Fatalf("%s izinli olmalıydı", k)
		}
	}
	if ok, _ := l.Allow("d"); ok {
		t.Error("anahtar üst sınırı aşılınca yeni anahtar reddedilmeli")
	}
	if ok, _ := l.Allow("a"); !ok {
		t.Error("var olan anahtar etkilenmemeli")
	}
}

func TestRateKey(t *testing.T) {
	tests := []struct {
		addr string
		want string
	}{
		{"203.0.113.9", "203.0.113.9"},
		{"::ffff:203.0.113.9", "203.0.113.9"}, // IPv4-mapped => IPv4
		{"2001:db8:1:2:aaaa:bbbb:cccc:dddd", "2001:db8:1:2::/64"},
		{"2001:db8:1:2:1111:2222:3333:4444", "2001:db8:1:2::/64"}, // aynı /64 => aynı anahtar
		{"2001:db8:1:3::1", "2001:db8:1:3::/64"},                  // farklı /64 => farklı anahtar
	}
	for _, tt := range tests {
		if got := RateKey(netip.MustParseAddr(tt.addr)); got != tt.want {
			t.Errorf("RateKey(%s) = %s, beklenen %s", tt.addr, got, tt.want)
		}
	}
	if got := RateKey(netip.Addr{}); got != "bilinmiyor" {
		t.Errorf("geçersiz adres anahtarı = %q", got)
	}
}
