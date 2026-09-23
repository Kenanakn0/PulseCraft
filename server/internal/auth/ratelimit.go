package auth

import (
	"context"
	"net/netip"
	"sync"
	"time"
)

// defaultMaxKeys: takip edilen en fazla farklı istemci sayısı (bellek koruması).
const defaultMaxKeys = 100_000

// RateLimiter: anahtar (istemci IP'si) başına kayan pencere sınırlayıcı.
// "Son window süresi içinde en fazla limit deneme" kuralını tam olarak uygular
// (sabit pencerenin sınırda iki katı denemeye izin veren zayıflığı yoktur).
// Reddedilen denemeler kaydedilmez; yani saldırgan sürekli denese de kilit
// sonsuza uzamaz, pencere kayarak açılır.
type RateLimiter struct {
	mu      sync.Mutex
	limit   int
	window  time.Duration
	maxKeys int
	now     func() time.Time
	hits    map[string][]time.Time
}

func NewRateLimiter(limit int, window time.Duration) *RateLimiter {
	return &RateLimiter{
		limit:   limit,
		window:  window,
		maxKeys: defaultMaxKeys,
		now:     time.Now,
		hits:    make(map[string][]time.Time),
	}
}

// Allow: key için yeni bir denemeye izin varsa true döner ve denemeyi kaydeder.
// İzin yoksa false ve tekrar denemek için beklenmesi gereken süreyi döner.
func (l *RateLimiter) Allow(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	recent := prune(l.hits[key], now.Add(-l.window))

	if len(recent) >= l.limit {
		l.hits[key] = recent
		if len(recent) == 0 { // limit <= 0: hiçbir denemeye izin yok
			return false, l.window
		}
		return false, recent[0].Add(l.window).Sub(now)
	}

	if _, known := l.hits[key]; !known && len(l.hits) >= l.maxKeys {
		l.cleanupLocked(now)
		if len(l.hits) >= l.maxKeys {
			// Bellek koruması: çok fazla farklı istemci varken yeni gelenleri
			// reddediyoruz (kapalı-başarısız). Gerçekçi bir yük değildir.
			return false, l.window
		}
	}

	l.hits[key] = append(recent, now)
	return true, 0
}

// Cleanup: penceresi tamamen geçmiş (boşta) anahtarları siler.
func (l *RateLimiter) Cleanup() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.cleanupLocked(l.now())
}

func (l *RateLimiter) cleanupLocked(now time.Time) {
	cutoff := now.Add(-l.window)
	for key, times := range l.hits {
		if len(prune(times, cutoff)) == 0 {
			delete(l.hits, key)
		}
	}
}

// Run: interval aralığıyla Cleanup çağırır; ctx iptal edilince durur.
func (l *RateLimiter) Run(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			l.Cleanup()
		}
	}
}

// prune: cutoff'tan ESKİ kayıtları atar (times zamana göre sıralıdır).
func prune(times []time.Time, cutoff time.Time) []time.Time {
	i := 0
	for i < len(times) && !times[i].After(cutoff) {
		i++
	}
	return times[i:]
}

// RateKey: IP'yi sınırlayıcı anahtarına çevirir. IPv6'da tek bir kullanıcı
// genellikle koca bir /64 bloğuna sahiptir; adres başına saymak, saldırganın her
// denemede blok içinden yeni bir adres seçip limiti atlatmasına izin verirdi.
// Bu yüzden IPv6 adresleri /64 önekine indirgenir.
func RateKey(addr netip.Addr) string {
	if !addr.IsValid() {
		return "bilinmiyor"
	}
	addr = addr.Unmap()
	if addr.Is6() {
		return netip.PrefixFrom(addr, 64).Masked().String()
	}
	return addr.String()
}
