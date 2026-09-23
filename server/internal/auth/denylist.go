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
	mu       sync.Mutex
	entries  map[string]time.Time // jti -> token'ın son geçerlilik zamanı
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

// Revoke: jti'yi, token süresi dolana dek geçersiz sayar ve o jti'yi
// Watch ile izleyenleri (ör. açık WebSocket bağlantıları) uyandırır.
func (d *Denylist) Revoke(jti string, expiresAt time.Time) {
	d.mu.Lock()
	defer d.mu.Unlock()

	d.entries[jti] = expiresAt
	for _, ch := range d.watchers[jti] {
		close(ch)
	}
	delete(d.watchers, jti)
}

// Watch: jti iptal edildiğinde kapanan bir channel döndürür (channel'lar
// C#'taki bir TaskCompletionSource/CancellationToken gibi "olay oldu" sinyali
// taşıyabilir; kapanmış channel'dan okumak hemen döner). jti ZATEN iptal
// edilmişse channel kapalı döner, böylece giriş-kontrol ile Watch arasındaki
// yarış kapanır. Dönen fonksiyon izlemeyi bırakır; izleyen taraf işi bitince
// (bağlantı normal kapanınca) çağırmalıdır, yoksa kayıt bellekte kalır.
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
