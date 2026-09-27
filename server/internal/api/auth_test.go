package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/Kenanakn0/pulsecraft/server/internal/auth"
	"github.com/Kenanakn0/pulsecraft/server/internal/clientip"
)

const apiTestSecret = "api-testi-icin-yeterince-uzun-gizli-anahtar-123456"

func newTestAPI(t *testing.T, trustedProxies string) (*API, http.Handler) {
	t.Helper()

	prefixes, err := clientip.ParseTrustedProxies(trustedProxies)
	if err != nil {
		t.Fatal(err)
	}
	a := &API{
		Tokens:       auth.NewTokenService(apiTestSecret, time.Hour),
		Denylist:     auth.NewDenylist(),
		LoginLimiter: auth.NewRateLimiter(10, time.Minute),
		ClientIP:     clientip.New(prefixes),
		CookieSecure: true,
	}

	r := chi.NewRouter()
	r.Post("/login", a.handleLogin)
	r.Post("/logout", a.handleLogout)
	r.With(a.requireAuth).Get("/me", a.handleMe)
	return a, r
}

// login sends an invalid JSON body. It is rejected with 400 before touching the database, but the rate
// limit runs before body validation and counts every attempt, so the limit is testable without a DB.
func login(h http.Handler, remoteAddr, xff string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/login", strings.NewReader("json-degil"))
	req.RemoteAddr = remoteAddr
	if xff != "" {
		req.Header.Set("X-Forwarded-For", xff)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestLogin_RateLimit_11thAttemptIs429(t *testing.T) {
	_, h := newTestAPI(t, "")

	for i := 1; i <= 10; i++ {
		if rec := login(h, "203.0.113.9:5000", ""); rec.Code != http.StatusBadRequest {
			t.Fatalf("%d. deneme: kod = %d, beklenen 400 (sınıra kadar gövde doğrulamasına ulaşmalı)", i, rec.Code)
		}
	}

	rec := login(h, "203.0.113.9:5000", "")
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("11. deneme: kod = %d, beklenen 429", rec.Code)
	}
	retry, err := strconv.Atoi(rec.Header().Get("Retry-After"))
	if err != nil || retry < 1 || retry > 60 {
		t.Errorf("Retry-After = %q, 1-60 arası saniye bekleniyordu", rec.Header().Get("Retry-After"))
	}

	if rec := login(h, "198.51.100.1:5000", ""); rec.Code != http.StatusBadRequest {
		t.Errorf("başka IP'nin kodu = %d, beklenen 400", rec.Code)
	}
}

func TestLogin_RateLimit_SpoofedXFFCannotBypass(t *testing.T) {
	// No trusted proxy: X-Forwarded-For must be ignored entirely.
	_, h := newTestAPI(t, "")

	for i := 1; i <= 10; i++ {
		login(h, "203.0.113.9:5000", fmt.Sprintf("10.0.0.%d", i)) // a different forged IP on every attempt
	}
	rec := login(h, "203.0.113.9:5000", "10.0.0.200")
	if rec.Code != http.StatusTooManyRequests {
		t.Errorf("sahte X-Forwarded-For limiti atlattı: kod = %d, beklenen 429", rec.Code)
	}
}

func TestLogin_RateLimit_TrustedProxy(t *testing.T) {
	_, h := newTestAPI(t, "10.0.0.0/8")
	proxy := "10.1.1.1:4000"

	// Client A tries to evade the limit from behind the proxy by prepending a different forged address on
	// every attempt.
	for i := 1; i <= 10; i++ {
		login(h, proxy, fmt.Sprintf("1.1.1.%d, 198.51.100.7", i))
	}
	if rec := login(h, proxy, "9.9.9.9, 198.51.100.7"); rec.Code != http.StatusTooManyRequests {
		t.Errorf("zincirin soluna sahte adres eklemek limiti atlattı: kod = %d", rec.Code)
	}

	// A different client behind the same proxy has its own bucket.
	if rec := login(h, proxy, "198.51.100.8"); rec.Code != http.StatusBadRequest {
		t.Errorf("başka istemci etkilendi: kod = %d, beklenen 400", rec.Code)
	}

	// An untrusted peer pretending to be a proxy can neither drain someone else's bucket nor escape its
	// own: RemoteAddr decides.
	for i := 1; i <= 10; i++ {
		login(h, "203.0.113.9:5000", "198.51.100.8")
	}
	if rec := login(h, "203.0.113.9:5000", "198.51.100.99"); rec.Code != http.StatusTooManyRequests {
		t.Errorf("güvenilmeyen eş başlıkla limiti atlattı: kod = %d", rec.Code)
	}
}

func TestLogin_RateLimit_IPv6AddressRotationWithinPrefix(t *testing.T) {
	_, h := newTestAPI(t, "")

	// A different address from the same /64 on every attempt counts as one client.
	for i := 1; i <= 10; i++ {
		login(h, fmt.Sprintf("[2001:db8:1:2::%x]:5000", i), "")
	}
	if rec := login(h, "[2001:db8:1:2::ffff]:5000", ""); rec.Code != http.StatusTooManyRequests {
		t.Errorf("IPv6 adres döndürme limiti atlattı: kod = %d", rec.Code)
	}
	if rec := login(h, "[2001:db8:1:3::1]:5000", ""); rec.Code != http.StatusBadRequest {
		t.Errorf("farklı /64 etkilendi: kod = %d", rec.Code)
	}
}

func TestLogin_ValidationErrors(t *testing.T) {
	_, h := newTestAPI(t, "")

	tests := []struct{ name, body string }{
		{"e-posta boş", `{"email":"","password":"x"}`},
		{"parola boş", `{"email":"a@example.test","password":""}`},
		{"alanlar yok", `{}`},
	}
	for i, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/login", strings.NewReader(tt.body))
			req.RemoteAddr = fmt.Sprintf("192.0.2.%d:1", i+1) // keep tests from sharing a limit
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Errorf("kod = %d, beklenen 400", rec.Code)
			}
		})
	}
}

func TestSessionCookieAttributes(t *testing.T) {
	a, _ := newTestAPI(t, "")
	exp := time.Now().Add(8 * time.Hour)

	c := a.newSessionCookie("tok", exp)
	if c.Name != "pulsecraft_session" || c.Value != "tok" || c.Path != "/" {
		t.Errorf("ad/değer/yol yanlış: %+v", c)
	}
	if !c.HttpOnly {
		t.Error("HttpOnly olmalı")
	}
	if c.SameSite != http.SameSiteStrictMode {
		t.Errorf("SameSite = %v, beklenen Strict", c.SameSite)
	}
	if !c.Secure {
		t.Error("CookieSecure=true iken Secure olmalı")
	}
	if c.MaxAge < 8*3600-5 || c.MaxAge > 8*3600 {
		t.Errorf("MaxAge = %d, ~28800 bekleniyordu", c.MaxAge)
	}

	a.CookieSecure = false
	if a.newSessionCookie("tok", exp).Secure {
		t.Error("CookieSecure=false iken Secure olmamalı")
	}

	gone := a.expiredSessionCookie()
	if gone.MaxAge >= 0 || gone.Value != "" || !gone.HttpOnly || gone.SameSite != http.SameSiteStrictMode {
		t.Errorf("silme cookie'si yanlış: %+v", gone)
	}
}

func getMe(h http.Handler, cookieValue string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/me", nil)
	if cookieValue != "" {
		req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: cookieValue})
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func postLogout(h http.Handler, cookieValue string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/logout", nil)
	if cookieValue != "" {
		req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: cookieValue})
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func clearedCookie(rec *httptest.ResponseRecorder) bool {
	for _, c := range rec.Result().Cookies() {
		if c.Name == sessionCookieName && c.MaxAge < 0 {
			return true
		}
	}
	return false
}

func TestMe_RequiresValidSession(t *testing.T) {
	a, h := newTestAPI(t, "")
	good, _, err := a.Tokens.Issue(auth.User{ID: 7, Email: "admin@pulsecraft.local", DisplayName: "Admin"})
	if err != nil {
		t.Fatal(err)
	}

	if rec := getMe(h, ""); rec.Code != http.StatusUnauthorized {
		t.Errorf("cookie yok: kod = %d, beklenen 401", rec.Code)
	}

	rec := getMe(h, good)
	if rec.Code != http.StatusOK {
		t.Fatalf("geçerli oturum: kod = %d, beklenen 200", rec.Code)
	}
	if body := rec.Body.String(); !strings.Contains(body, `"email":"admin@pulsecraft.local"`) ||
		!strings.Contains(body, `"display_name":"Admin"`) || strings.Contains(strings.ToLower(body), "password") {
		t.Errorf("yanıt gövdesi beklenmedik: %s", body)
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Error("kimlik yanıtları no-store olmalı")
	}

	other := auth.NewTokenService("baska-bir-gizli-anahtar-en-az-32-karakter-uzun", time.Hour)
	forged, _, _ := other.Issue(auth.User{ID: 7, Email: "x@y.z", DisplayName: "X"})
	expired, _, _ := auth.NewTokenService(apiTestSecret, -time.Hour).Issue(auth.User{ID: 7, Email: "x@y.z", DisplayName: "X"})
	for name, tok := range map[string]string{"bozuk": "bu.bir.token.degil", "sahte imza": forged, "süresi dolmuş": expired} {
		rec := getMe(h, tok)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s: kod = %d, beklenen 401", name, rec.Code)
		}
		if !clearedCookie(rec) {
			t.Errorf("%s: geçersiz cookie silinmeli", name)
		}
	}
}

func TestLogout_RevokesOldCookie(t *testing.T) {
	a, h := newTestAPI(t, "")
	tok, _, err := a.Tokens.Issue(auth.User{ID: 7, Email: "admin@pulsecraft.local", DisplayName: "Admin"})
	if err != nil {
		t.Fatal(err)
	}

	if rec := getMe(h, tok); rec.Code != http.StatusOK {
		t.Fatalf("logout öncesi oturum geçerli olmalı: kod = %d", rec.Code)
	}

	rec := postLogout(h, tok)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("logout kodu = %d, beklenen 204", rec.Code)
	}
	if !clearedCookie(rec) {
		t.Error("logout cookie'yi silmeli")
	}

	// Replaying the old cookie (e.g. with curl): signature and expiry are still valid, but the jti is revoked.
	if rec := getMe(h, tok); rec.Code != http.StatusUnauthorized {
		t.Errorf("logout sonrası eski cookie: kod = %d, beklenen 401", rec.Code)
	}

	// A new login of the same user (new jti) is unaffected.
	fresh, _, _ := a.Tokens.Issue(auth.User{ID: 7, Email: "admin@pulsecraft.local", DisplayName: "Admin"})
	if rec := getMe(h, fresh); rec.Code != http.StatusOK {
		t.Errorf("yeni oturum: kod = %d, beklenen 200", rec.Code)
	}
}

func TestLogout_IsIdempotent(t *testing.T) {
	_, h := newTestAPI(t, "")

	for name, cookie := range map[string]string{"cookie yok": "", "geçersiz cookie": "bozuk.token.degeri"} {
		rec := postLogout(h, cookie)
		if rec.Code != http.StatusNoContent || !clearedCookie(rec) {
			t.Errorf("%s: kod = %d, cookie silindi = %v; beklenen 204 + silinen cookie", name, rec.Code, clearedCookie(rec))
		}
	}
}
