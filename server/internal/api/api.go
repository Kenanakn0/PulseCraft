package api

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Kenanakn0/pulsecraft/server/internal/alerting"
	"github.com/Kenanakn0/pulsecraft/server/internal/auth"
	"github.com/Kenanakn0/pulsecraft/server/internal/clientip"
	"github.com/Kenanakn0/pulsecraft/server/internal/realtime"
)

// API: tüm HTTP handler'ların paylaştığı bağımlılıkları tutar. C#'taki bir
// Controller'ın constructor injection ile aldığı bağımlılıklara benzer, ama
// Go'da DI container yok — bağımlılıkları elle bir struct'a koyup
// metotları o struct üzerinde tanımlıyoruz.
type API struct {
	DB     *pgxpool.Pool
	Engine *alerting.Engine
	Pub    *realtime.Publisher
	Hub    *realtime.Hub

	// Kimlik doğrulama (Evre 4.0)
	Tokens       *auth.TokenService
	Denylist     *auth.Denylist
	LoginLimiter *auth.RateLimiter
	ClientIP     *clientip.Resolver
	CookieSecure bool
}

// Routes: tüm route'ları bir chi.Router üzerinde tanımlar.
func (a *API) Routes() chi.Router {
	r := chi.NewRouter()
	r.Use(middleware.Logger)

	// ---- Oturum GEREKTİRMEYENLER (yalnızca bunlar; başka her şey aşağıdaki grupta) ----
	r.Get("/healthz", a.handleHealthz)
	r.Post("/api/v1/auth/login", a.handleLogin)
	r.Post("/api/v1/auth/logout", a.handleLogout)
	// Agent'lar oturum değil node API key'iyle (Bearer) kimlik doğrular.
	r.Post("/api/v1/metrics", a.handleIngestMetrics)

	// ---- Oturum GEREKTİRENLER ----
	// Yeni bir route'u yanlışlıkla korumasız bırakmamak için hepsi tek grupta;
	// TestRoutes_OnlyExplicitlyPublicOnesSkipSession bunu zorlar.
	r.Group(func(r chi.Router) {
		r.Use(a.requireAuth)

		r.Get("/api/v1/auth/me", a.handleMe)

		r.Route("/api/v1/nodes", func(r chi.Router) {
			r.Post("/", a.handleCreateNode)
			r.Get("/", a.handleListNodes)
			r.Get("/{id}/metrics", a.handleGetNodeMetrics)
		})

		r.Route("/api/v1/alert-rules", func(r chi.Router) {
			r.Post("/", a.handleCreateRule)
			r.Get("/", a.handleListRules)
			r.Put("/{id}", a.handleUpdateRule)
			r.Delete("/{id}", a.handleDeleteRule)
		})

		r.Get("/api/v1/alerts", a.handleListAlerts)
		r.Post("/api/v1/alerts/{id}/ack", a.handleAckAlert)

		r.Get("/ws", a.handleWS)
	})

	return r
}

// handleWS: oturumu doğrulanmış (requireAuth) isteği WebSocket'e yükseltir.
// Bağlantı, token'ın süresi dolduğunda ya da logout ile iptal edildiğinde
// SUNUCU tarafından kapatılır (close code 4401).
func (a *API) handleWS(w http.ResponseWriter, r *http.Request) {
	claims, ok := auth.ClaimsFromContext(r.Context())
	if !ok {
		http.Error(w, "oturum gerekli", http.StatusUnauthorized)
		return
	}

	// Watch, requireAuth'taki IsRevoked kontrolüyle yükseltme arasında araya
	// giren bir logout'u da yakalar (iptal edilmişse channel baştan kapalıdır).
	revoked, unwatch := a.Denylist.Watch(claims.ID)
	defer unwatch()

	a.Hub.ServeWS(w, r, realtime.Session{ExpiresAt: claims.ExpiresAt.Time, Revoked: revoked})
}

// handleHealthz: DB'ye gerçekten ping atarak sunucunun ve veritabanının
// ayakta olup olmadığını doğrular.
func (a *API) handleHealthz(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if err := a.DB.Ping(r.Context()); err != nil {
		slog.Error("healthz: db ping başarısız", "err", err)
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{"status": "db_unreachable"})
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
