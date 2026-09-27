package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"math"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

const maxNodeNameRunes = 100

// onlineThreshold is compared on the server with the database clock (now() - last_seen_at), so a wrong
// browser clock cannot affect the status. With the default 3 s agent interval it tolerates a few misses.
const onlineThreshold = 15 * time.Second

// NodeLatest is the newest stored sample, so cards can show values immediately (null without samples).
type NodeLatest struct {
	Time         time.Time `json:"time"`
	CPUPercent   float64   `json:"cpu_percent"`
	MemPercent   float64   `json:"mem_percent"`
	MemUsedBytes int64     `json:"mem_used_bytes"`
	DiskPercent  float64   `json:"disk_percent"`
	NetRxBps     int64     `json:"net_rx_bps"`
	NetTxBps     int64     `json:"net_tx_bps"`
	Load1        *float64  `json:"load1"`
}

// Node never includes api_key_hash; the plain key is shown only once, at creation.
type Node struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Hostname   *string `json:"hostname"`
	OS         *string `json:"os"`
	IsActive   bool    `json:"is_active"`
	LastSeenAt *string `json:"last_seen_at"`
	CreatedAt  string  `json:"created_at"`

	// Online and LastSeenSecondsAgo are computed on the server (see onlineThreshold).
	Online             bool        `json:"online"`
	LastSeenSecondsAgo *float64    `json:"last_seen_seconds_ago"`
	Latest             *NodeLatest `json:"latest"`
}

func isOnline(secondsAgo *float64) bool {
	return secondsAgo != nil && *secondsAgo <= onlineThreshold.Seconds()
}

type createNodeRequest struct {
	Name     string `json:"name"`
	Hostname string `json:"hostname"`
	OS       string `json:"os"`
}

// createNodeResponse is the only place where the plain API key is ever returned.
type createNodeResponse struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	APIKey string `json:"api_key"`
}

func (a *API) handleCreateNode(w http.ResponseWriter, r *http.Request) {
	var req createNodeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "geçersiz istek gövdesi", http.StatusBadRequest)
		return
	}
	// Trim: a name of only spaces would render as an invisible card.
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		http.Error(w, "name zorunlu", http.StatusBadRequest)
		return
	}
	if utf8.RuneCountInString(req.Name) > maxNodeNameRunes {
		http.Error(w, "name en fazla 100 karakter olabilir", http.StatusBadRequest)
		return
	}

	apiKey, err := generateAPIKey()
	if err != nil {
		slog.Error("api key üretilemedi", "err", err)
		http.Error(w, "sunucu hatası", http.StatusInternalServerError)
		return
	}
	hash := hashAPIKey(apiKey)

	var id string
	err = a.DB.QueryRow(r.Context(),
		`INSERT INTO nodes (name, hostname, os, api_key_hash)
		 VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), $4)
		 RETURNING id`,
		req.Name, req.Hostname, req.OS, hash,
	).Scan(&id)
	if err != nil {
		slog.Error("node eklenemedi", "err", err)
		http.Error(w, "sunucu hatası", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(createNodeResponse{ID: id, Name: req.Name, APIKey: apiKey})
}

func (a *API) handleListNodes(w http.ResponseWriter, r *http.Request) {
	// LEFT JOIN LATERAL fetches the newest sample per node through the (node_id, time DESC) index; nodes
	// without samples get NULLs. The age is computed with the database clock.
	rows, err := a.DB.Query(r.Context(),
		`SELECT n.id, n.name, n.hostname, n.os, n.is_active, n.last_seen_at, n.created_at,
		        EXTRACT(EPOCH FROM (now() - n.last_seen_at))::float8,
		        m.time, m.cpu_percent, m.mem_percent, m.mem_used_bytes, m.disk_percent,
		        m.net_rx_bps, m.net_tx_bps, m.load1
		 FROM nodes n
		 LEFT JOIN LATERAL (
		     SELECT time, cpu_percent, mem_percent, mem_used_bytes, disk_percent,
		            net_rx_bps, net_tx_bps, load1
		     FROM metrics WHERE node_id = n.id ORDER BY time DESC LIMIT 1
		 ) m ON true
		 ORDER BY n.created_at DESC`)
	if err != nil {
		slog.Error("node listesi okunamadı", "err", err)
		http.Error(w, "sunucu hatası", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	nodes := []Node{}
	for rows.Next() {
		var n Node
		var lastSeen *time.Time
		var createdAt time.Time
		var age *float64

		var (
			mTime                    *time.Time
			mCPU, mMem, mDisk        *float64
			mMemUsed, mNetRx, mNetTx *int64
			mLoad1                   *float64
		)
		if err := rows.Scan(&n.ID, &n.Name, &n.Hostname, &n.OS, &n.IsActive, &lastSeen, &createdAt, &age,
			&mTime, &mCPU, &mMem, &mMemUsed, &mDisk, &mNetRx, &mNetTx, &mLoad1); err != nil {
			slog.Error("node satırı okunamadı", "err", err)
			http.Error(w, "sunucu hatası", http.StatusInternalServerError)
			return
		}
		n.CreatedAt = createdAt.Format(time.RFC3339)
		if lastSeen != nil {
			s := lastSeen.Format(time.RFC3339)
			n.LastSeenAt = &s
		}
		if age != nil {
			ago := math.Max(*age, 0) // no negative values if the clock jumps
			n.LastSeenSecondsAgo = &ago
		}
		n.Online = isOnline(n.LastSeenSecondsAgo)

		if mTime != nil && mCPU != nil && mMem != nil && mMemUsed != nil && mDisk != nil && mNetRx != nil && mNetTx != nil {
			n.Latest = &NodeLatest{
				Time: *mTime, CPUPercent: *mCPU, MemPercent: *mMem, MemUsedBytes: *mMemUsed,
				DiskPercent: *mDisk, NetRxBps: *mNetRx, NetTxBps: *mNetTx, Load1: mLoad1,
			}
		}
		nodes = append(nodes, n)
	}
	if err := rows.Err(); err != nil {
		slog.Error("node listesi iterasyon hatası", "err", err)
		http.Error(w, "sunucu hatası", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(nodes)
}

// generateAPIKey uses crypto/rand: API keys must not be predictable (never math/rand).
func generateAPIKey() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// Only the hash of an API key is stored.
func hashAPIKey(apiKey string) string {
	sum := sha256.Sum256([]byte(apiKey))
	return hex.EncodeToString(sum[:])
}

// handleDeleteNode deletes the node and, by cascade, its metrics, its alert history and the rules scoped
// to it; the key hash goes too, so its agent gets 401 from now on. The order mirrors handleDeleteRule:
// read the ids of the rules that the cascade will remove, resolve and announce active alerts, delete and
// refresh the engine, then announce each deleted rule and finally the deleted node, so that open clients
// drop the corresponding rows.
func (a *API) handleDeleteNode(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := chi.URLParam(r, "id")

	rows, err := a.DB.Query(ctx, `SELECT id FROM alert_rules WHERE node_id = $1 ORDER BY id`, id)
	if err != nil {
		a.writeDBError(w, "sunucunun kuralları okunamadı", err) // invalid UUID → 400
		return
	}
	ruleIDs, err := pgx.CollectRows(rows, pgx.RowTo[int64])
	if err != nil {
		a.writeDBError(w, "sunucunun kuralları okunamadı", err)
		return
	}

	if _, err := a.Engine.ResolveNodeAlerts(ctx, id); err != nil {
		a.writeDBError(w, "sunucunun alarmları çözülemedi", err)
		return
	}

	tag, err := a.DB.Exec(ctx, `DELETE FROM nodes WHERE id = $1`, id)
	if err != nil {
		a.writeDBError(w, "sunucu silinemedi", err)
		return
	}
	if tag.RowsAffected() == 0 {
		http.Error(w, "sunucu bulunamadı", http.StatusNotFound)
		return
	}

	a.refreshEngine(ctx)
	for _, ruleID := range ruleIDs {
		a.Pub.PublishRuleDeleted(ruleID)
	}
	a.Pub.PublishNodeDeleted(id)
	slog.Info("sunucu silindi", "node_id", id, "silinen_kural", len(ruleIDs))
	w.WriteHeader(http.StatusNoContent)
}
