package auth

import (
	"testing"
	"time"
)

func isClosed(ch <-chan struct{}) bool {
	select {
	case <-ch:
		return true
	default:
		return false
	}
}

func TestDenylist_Watch(t *testing.T) {
	d := NewDenylist()

	a1, cancelA1 := d.Watch("a")
	a2, cancelA2 := d.Watch("a")
	b, cancelB := d.Watch("b")
	defer cancelB()

	if isClosed(a1) || isClosed(a2) || isClosed(b) {
		t.Fatal("iptal edilmeden channel'lar kapanmamalı")
	}

	// a'yı izleyenlerden biri vazgeçer: yalnızca kalan izleyici uyandırılmalı.
	cancelA1()
	d.Revoke("a", time.Now().Add(time.Hour))
	if !isClosed(a2) {
		t.Error("a'yı izleyen kapanmalıydı")
	}
	if isClosed(a1) {
		t.Error("izlemeyi bırakan kapatılmamalı (çift kapatma riski)")
	}
	if isClosed(b) {
		t.Error("iptal edilmeyen b etkilenmemeli")
	}
	cancelA2() // Revoke'tan sonra cancel çağrısı güvenli olmalı (panik yok)

	// İkinci Revoke de güvenli olmalı.
	d.Revoke("a", time.Now().Add(time.Hour))

	// Zaten iptal edilmiş jti izlenirse channel baştan kapalı gelir (yarış koruması).
	late, cancelLate := d.Watch("a")
	defer cancelLate()
	if !isClosed(late) {
		t.Error("iptal edilmiş jti için Watch kapalı channel dönmeli")
	}

	if n := len(d.watchers); n != 1 { // yalnızca b kaldı
		t.Errorf("izleyici kaydı sızıyor: %d anahtar, beklenen 1", n)
	}
}

func TestDenylist_RevokeAndCleanup(t *testing.T) {
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	d := NewDenylist()
	d.now = func() time.Time { return now }

	d.Revoke("kisa-omurlu", now.Add(10*time.Minute))
	d.Revoke("uzun-omurlu", now.Add(8*time.Hour))

	if !d.IsRevoked("kisa-omurlu") || !d.IsRevoked("uzun-omurlu") {
		t.Fatal("iptal edilen jti'ler denylist'te olmalı")
	}
	if d.IsRevoked("hic-iptal-edilmedi") {
		t.Error("iptal edilmemiş jti reddedilmemeli")
	}

	// Henüz hiçbir şeyin süresi dolmadı: temizlik bir şey silmemeli.
	if n := d.Cleanup(); n != 0 || d.Len() != 2 {
		t.Errorf("erken temizlik: silinen=%d, kalan=%d", n, d.Len())
	}

	// 30 dk sonra: sadece kısa ömürlü kayıt silinmeli.
	now = now.Add(30 * time.Minute)
	if n := d.Cleanup(); n != 1 {
		t.Errorf("silinen = %d, beklenen 1", n)
	}
	if d.IsRevoked("kisa-omurlu") {
		t.Error("süresi dolan kayıt temizlenmeliydi")
	}
	if !d.IsRevoked("uzun-omurlu") {
		t.Error("süresi dolmayan kayıt korunmalı")
	}

	// 9 saat sonra hepsi gider.
	now = now.Add(9 * time.Hour)
	d.Cleanup()
	if d.Len() != 0 {
		t.Errorf("kalan = %d, beklenen 0", d.Len())
	}
}
