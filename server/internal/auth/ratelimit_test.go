package auth

import (
	"net/netip"
	"testing"
	"time"
)

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
		clock.advance(time.Second) // one attempt per second: t=0..9
	}

	// The 11th attempt (t=10 s) is rejected; the first one (t=0) leaves the window at 60 s.
	ok, retry := l.Allow("1.2.3.4")
	if ok {
		t.Fatal("11. deneme reddedilmeliydi")
	}
	if retry != 50*time.Second {
		t.Errorf("retryAfter = %v, beklenen 50s", retry)
	}

	// Rejected attempts are not recorded: at t=60 the first attempt has left the window.
	clock.advance(50 * time.Second)
	if ok, _ := l.Allow("1.2.3.4"); !ok {
		t.Error("pencere kaydıktan sonra bir deneme izinli olmalı")
	}
	// But the other attempts are still in the window, so the next one is rejected again.
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
	l.Allow("b")                    // b is still active
	clock.advance(45 * time.Second) // a's attempt was 75 s ago, b's last one 45 s ago

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
		{"::ffff:203.0.113.9", "203.0.113.9"},
		{"2001:db8:1:2:aaaa:bbbb:cccc:dddd", "2001:db8:1:2::/64"},
		{"2001:db8:1:2:1111:2222:3333:4444", "2001:db8:1:2::/64"},
		{"2001:db8:1:3::1", "2001:db8:1:3::/64"},
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
