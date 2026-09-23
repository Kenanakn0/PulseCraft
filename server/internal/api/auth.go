package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Kenanakn0/pulsecraft/server/internal/auth"
)

// sessionCookieName: JWT'yi taşıyan cookie'nin adı.
const sessionCookieName = "pulsecraft_session"

// maxLoginBody: login gövdesi için üst sınır (bellek tüketimi saldırılarına karşı).
const maxLoginBody = 4 << 10

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// UserInfo: istemciye dönen kullanıcı bilgisi (parola/hash asla dönmez).
type UserInfo struct {
	ID          int64  `json:"id"`
	Email       string `json:"email"`
	DisplayName string `json:"display_name"`
}

// handleLogin: e-posta + parola ile giriş yapar, JWT'yi httpOnly cookie'ye koyar.
//
// Sıra bilinçli: önce rate limit (bcrypt gibi pahalı işlerden ve DB'den ÖNCE),
// sonra gövde doğrulaması, sonra kimlik doğrulama.
func (a *API) handleLogin(w http.ResponseWriter, r *http.Request) {
	ip := a.ClientIP.ClientIP(r)
	if ok, retryAfter := a.LoginLimiter.Allow(auth.RateKey(ip)); !ok {
		seconds := int(math.Ceil(retryAfter.Seconds()))
		if seconds < 1 {
			seconds = 1
		}
		w.Header().Set("Retry-After", strconv.Itoa(seconds))
		slog.Warn("giriş denemesi sınırı aşıldı", "ip", ip.String())
		http.Error(w, "çok fazla giriş denemesi, biraz sonra tekrar deneyin", http.StatusTooManyRequests)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxLoginBody)
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "geçersiz istek gövdesi", http.StatusBadRequest)
		return
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if email == "" || req.Password == "" {
		http.Error(w, "e-posta ve parola zorunlu", http.StatusBadRequest)
		return
	}

	var (
		user  auth.User
		hash  string
		found = true
	)
	err := a.DB.QueryRow(r.Context(),
		`SELECT id, email, display_name, password_hash FROM users WHERE lower(email) = $1`, email,
	).Scan(&user.ID, &user.Email, &user.DisplayName, &hash)
	if errors.Is(err, pgx.ErrNoRows) {
		found = false
	} else if err != nil {
		slog.Error("kullanıcı sorgulanamadı", "err", err)
		http.Error(w, "sunucu hatası", http.StatusInternalServerError)
		return
	}

	// Kullanıcı bulunamasa da sahte hash'le tam bir bcrypt karşılaştırması
	// yapılır (bkz. auth.VerifyPassword): iki durumda da yanıt süresi ve mesajı
	// aynı, kayıtlı e-postalar sızmaz.
	if !auth.VerifyPassword(hash, found, req.Password) {
		slog.Warn("giriş başarısız", "ip", ip.String())
		http.Error(w, "e-posta veya parola hatalı", http.StatusUnauthorized)
		return
	}

	token, claims, err := a.Tokens.Issue(user)
	if err != nil {
		slog.Error("token üretilemedi", "err", err)
		http.Error(w, "sunucu hatası", http.StatusInternalServerError)
		return
	}

	http.SetCookie(w, a.newSessionCookie(token, claims.ExpiresAt.Time))
	slog.Info("giriş yapıldı", "user_id", user.ID)
	writeAuthJSON(w, http.StatusOK, map[string]any{
		"user": UserInfo{ID: user.ID, Email: user.Email, DisplayName: user.DisplayName},
	})
}

// handleLogout: token'ın jti'sini denylist'e yazar (süresi dolana dek geçersiz)
// ve cookie'yi siler. Oturum yoksa/geçersizse de cookie silinip 204 dönülür
// (idempotent).
func (a *API) handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookieName); err == nil {
		if claims, err := a.Tokens.Parse(c.Value); err == nil {
			a.Denylist.Revoke(claims.ID, claims.ExpiresAt.Time)
			slog.Info("çıkış yapıldı", "user_id", claims.UserID)
		}
	}
	http.SetCookie(w, a.expiredSessionCookie())
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

// handleMe: oturumdaki kullanıcıyı döner (requireAuth arkasında çalışır).
func (a *API) handleMe(w http.ResponseWriter, r *http.Request) {
	claims, ok := auth.ClaimsFromContext(r.Context())
	if !ok {
		http.Error(w, "oturum gerekli", http.StatusUnauthorized)
		return
	}
	writeAuthJSON(w, http.StatusOK, map[string]any{
		"user":       UserInfo{ID: claims.UserID, Email: claims.Email, DisplayName: claims.Name},
		"expires_at": claims.ExpiresAt.Time,
	})
}

// requireAuth: geçerli, süresi dolmamış ve iptal edilmemiş bir oturum cookie'si
// yoksa 401 döner; varsa kullanıcıyı (claims) context'e koyup devam eder —
// C#'taki [Authorize] + HttpContext.User karşılığı.
func (a *API) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(sessionCookieName)
		if err != nil {
			http.Error(w, "oturum gerekli", http.StatusUnauthorized)
			return
		}

		claims, err := a.Tokens.Parse(c.Value)
		if err != nil || a.Denylist.IsRevoked(claims.ID) {
			// Tarayıcı geçersiz cookie'yi göndermeyi bıraksın diye siliyoruz.
			http.SetCookie(w, a.expiredSessionCookie())
			http.Error(w, "oturum gerekli", http.StatusUnauthorized)
			return
		}

		next.ServeHTTP(w, r.WithContext(auth.WithClaims(r.Context(), claims)))
	})
}

// newSessionCookie: JWT'yi taşıyan cookie.
//   - HttpOnly: JavaScript okuyamaz (XSS ile token çalınamaz)
//   - SameSite=Strict: başka sitelerden gelen isteklerde gönderilmez (CSRF)
//   - Secure: yalnızca HTTPS'te gönderilir (COOKIE_SECURE ile açılır)
func (a *API) newSessionCookie(token string, expiresAt time.Time) *http.Cookie {
	return &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		Expires:  expiresAt,
		MaxAge:   int(time.Until(expiresAt).Seconds()),
		HttpOnly: true,
		Secure:   a.CookieSecure,
		SameSite: http.SameSiteStrictMode,
	}
}

// expiredSessionCookie: tarayıcıya cookie'yi silmesini söyler (MaxAge < 0).
func (a *API) expiredSessionCookie() *http.Cookie {
	return &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   a.CookieSecure,
		SameSite: http.SameSiteStrictMode,
	}
}

// writeAuthJSON: kimlik bilgisi içeren yanıtların önbelleğe alınmasını engeller.
func writeAuthJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, status, v)
}
