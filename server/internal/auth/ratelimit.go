package auth

import (
	"context"
	"net/netip"
	"sync"
	"time"
)

// defaultMaxKeys bounds memory use.
const defaultMaxKeys = 100_000

// RateLimiter is a sliding window per key (client IP): at most limit attempts in any window, without the
// fixed-window weakness of allowing twice the limit around a boundary. Rejected attempts are not recorded,
// so constant retrying does not extend the lockout forever.
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

// Allow records the attempt if allowed; otherwise it returns how long to wait.
func (l *RateLimiter) Allow(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	recent := prune(l.hits[key], now.Add(-l.window))

	if len(recent) >= l.limit {
		l.hits[key] = recent
		if len(recent) == 0 { // limit <= 0 allows nothing
			return false, l.window
		}
		return false, recent[0].Add(l.window).Sub(now)
	}

	if _, known := l.hits[key]; !known && len(l.hits) >= l.maxKeys {
		l.cleanupLocked(now)
		if len(l.hits) >= l.maxKeys {
			// Too many distinct clients: reject new ones (fail closed) rather than grow without bound.
			return false, l.window
		}
	}

	l.hits[key] = append(recent, now)
	return true, 0
}

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

// prune drops entries older than cutoff (times are sorted).
func prune(times []time.Time, cutoff time.Time) []time.Time {
	i := 0
	for i < len(times) && !times[i].After(cutoff) {
		i++
	}
	return times[i:]
}

// RateKey reduces IPv6 addresses to their /64: a single user usually controls a whole /64, and counting
// per address would let an attacker pick a new address for every attempt.
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
