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

// API holds the dependencies shared by all handlers.
type API struct {
	DB     *pgxpool.Pool
	Engine *alerting.Engine
	Pub    *realtime.Publisher
	Hub    *realtime.Hub

	Tokens       *auth.TokenService
	Denylist     *auth.Denylist
	LoginLimiter *auth.RateLimiter
	ClientIP     *clientip.Resolver
	CookieSecure bool
}

func (a *API) Routes() chi.Router {
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(newCrossOriginProtection().Handler)
	r.Use(limitBody(maxRequestBody))

	// Public routes: only these. Everything else goes into the group below.
	r.Get("/healthz", a.handleHealthz)
	r.Post("/api/v1/auth/login", a.handleLogin)
	r.Post("/api/v1/auth/logout", a.handleLogout)
	// Agents authenticate with their node API key (Bearer), not a session.
	r.Post("/api/v1/metrics", a.handleIngestMetrics)

	// All session routes live in one group so a new route cannot be left unprotected by accident;
	// TestRoutes_OnlyExplicitlyPublicOnesSkipSession enforces this.
	r.Group(func(r chi.Router) {
		r.Use(a.requireAuth)

		r.Get("/api/v1/auth/me", a.handleMe)

		r.Route("/api/v1/nodes", func(r chi.Router) {
			r.Post("/", a.handleCreateNode)
			r.Get("/", a.handleListNodes)
			r.Get("/{id}/metrics", a.handleGetNodeMetrics)
			r.Delete("/{id}", a.handleDeleteNode)
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

// maxRequestBody matches nginx's client_max_body_size, so the limit also holds when the
// server is reached without the proxy (e.g. `go run` in development).
const maxRequestBody = 2 << 20

// newCrossOriginProtection rejects state-changing browser requests from another origin.
// SameSite=Strict alone is not enough: pages on the same *site* (another localhost port,
// a sibling subdomain) still get the session cookie attached. Browsers always send
// Sec-Fetch-Site or Origin; non-browser clients such as the agent send neither and pass.
func newCrossOriginProtection() *http.CrossOriginProtection {
	cop := http.NewCrossOriginProtection()
	cop.SetDenyHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "çapraz kaynaklı istek reddedildi", http.StatusForbidden)
	}))
	return cop
}

func limitBody(n int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r.Body = http.MaxBytesReader(w, r.Body, n)
			next.ServeHTTP(w, r)
		})
	}
}

// handleWS upgrades an authenticated request. The server closes the connection with code 4401 when the
// token expires or is revoked by logout.
func (a *API) handleWS(w http.ResponseWriter, r *http.Request) {
	claims, ok := auth.ClaimsFromContext(r.Context())
	if !ok {
		http.Error(w, "oturum gerekli", http.StatusUnauthorized)
		return
	}

	// Watch also catches a logout between requireAuth's check and the upgrade (the channel is then
	// already closed).
	revoked, unwatch := a.Denylist.Watch(claims.ID)
	defer unwatch()

	a.Hub.ServeWS(w, r, realtime.Session{ExpiresAt: claims.ExpiresAt.Time, Revoked: revoked})
}

// handleHealthz pings the database, so the health check fails when the DB is unreachable.
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
