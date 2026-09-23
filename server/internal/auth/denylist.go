package auth

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

// Denylist: logout ile iptal edilen token kimliklerini (jti) bellekte tutar.
//
// Bilinen sınırlama: bellekte olduğu için server yeniden başlayınca sıfırlanır;
// o zamana dek iptal edilmiş ama süresi dolmamış bir token yeniden geçerli olur.
// (Şema değişikliği ve Redis bağımlılığı gerektirmemesi için bilinçli tercih.)
type Denylist struct {
	mu      sync.Mutex
	entries map[string]time.Time // jti -> token'ın son geçerlilik zamanı
	now     func() time.Time
}

func NewDenylist() *Denylist {
	return &Denylist{entries: make(map[string]time.Time), now: time.Now}
}

// Revoke: jti'yi, token süresi dolana dek geçersiz sayar.
func (d *Denylist) Revoke(jti string, expiresAt time.Time) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.entries[jti] = expiresAt
}

func (d *Denylist) IsRevoked(jti string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	_, ok := d.entries[jti]
	return ok
}

// Cleanup: süresi dolmuş kayıtları siler (o token'lar zaten süre kontrolünde
// reddedilir, denylist'te tutmaya gerek kalmaz). Silinen sayıyı döndürür.
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

// Run: interval aralığıyla Cleanup çağırır; ctx iptal edilince durur.
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
