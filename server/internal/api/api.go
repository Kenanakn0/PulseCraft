package api

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Kenanakn0/pulsecraft/server/internal/alerting"
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
}

// Routes: tüm route'ları bir chi.Router üzerinde tanımlar.
func (a *API) Routes() chi.Router {
	r := chi.NewRouter()
	r.Use(middleware.Logger)

	r.Get("/healthz", a.handleHealthz)

	r.Route("/api/v1/nodes", func(r chi.Router) {
		r.Post("/", a.handleCreateNode)
		r.Get("/", a.handleListNodes)
		r.Get("/{id}/metrics", a.handleGetNodeMetrics)
	})

	r.Post("/api/v1/metrics", a.handleIngestMetrics)

	r.Route("/api/v1/alert-rules", func(r chi.Router) {
		r.Post("/", a.handleCreateRule)
		r.Get("/", a.handleListRules)
		r.Put("/{id}", a.handleUpdateRule)
		r.Delete("/{id}", a.handleDeleteRule)
	})

	r.Get("/api/v1/alerts", a.handleListAlerts)
	r.Post("/api/v1/alerts/{id}/ack", a.handleAckAlert)

	r.Get("/ws", a.Hub.ServeWS)

	return r
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
