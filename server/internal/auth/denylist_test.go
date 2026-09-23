package auth

import (
	"testing"
	"time"
)

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
