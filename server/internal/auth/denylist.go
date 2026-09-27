package auth

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

// Denylist keeps the jti of logged-out tokens in memory until they expire.
//
// Known limitation: it resets on restart, so a revoked but unexpired token becomes valid again. Chosen
// deliberately to avoid a schema change and a Redis dependency.
type Denylist struct {
	mu       sync.Mutex
	entries  map[string]time.Time // jti -> token expiry
	watchers map[string][]chan struct{}
	now      func() time.Time
}

func NewDenylist() *Denylist {
	return &Denylist{
		entries:  make(map[string]time.Time),
		watchers: make(map[string][]chan struct{}),
		now:      time.Now,
	}
}

// Revoke also wakes up everything watching the jti (e.g. open WebSocket connections).
func (d *Denylist) Revoke(jti string, expiresAt time.Time) {
	d.mu.Lock()
	defer d.mu.Unlock()

	d.entries[jti] = expiresAt
	for _, ch := range d.watchers[jti] {
		close(ch)
	}
	delete(d.watchers, jti)
}

// Watch returns a channel that is closed when the jti is revoked; if it already is, the channel comes
// back closed, which closes the race between the session check and Watch. The returned function must be
// called when watching ends, or the entry stays in memory.
func (d *Denylist) Watch(jti string) (<-chan struct{}, func()) {
	d.mu.Lock()
	defer d.mu.Unlock()

	ch := make(chan struct{})
	if _, revoked := d.entries[jti]; revoked {
		close(ch)
		return ch, func() {}
	}
	d.watchers[jti] = append(d.watchers[jti], ch)

	cancel := func() {
		d.mu.Lock()
		defer d.mu.Unlock()
		list := d.watchers[jti]
		for i, w := range list {
			if w == ch {
				d.watchers[jti] = append(list[:i], list[i+1:]...)
				break
			}
		}
		if len(d.watchers[jti]) == 0 {
			delete(d.watchers, jti)
		}
	}
	return ch, cancel
}

func (d *Denylist) IsRevoked(jti string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	_, ok := d.entries[jti]
	return ok
}

// Cleanup removes expired entries (the expiry check rejects those tokens anyway).
func (d *Denylist) Cleanup() int {
	d.mu.Lock()
	defer d.mu.Unlock()

	now := d.now()
	removed := 0
	for jti, exp := range d.entries {
		if !exp.After(now) {
			delete(d.entries, jti)
			removed++
		}
	}
	return removed
}

func (d *Denylist) Len() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return len(d.entries)
}

func (d *Denylist) Run(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if n := d.Cleanup(); n > 0 {
				slog.Debug("denylist temizlendi", "silinen", n)
			}
		}
	}
}
