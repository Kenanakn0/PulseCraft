package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/Kenanakn0/pulsecraft/server/internal/alerting"
	"github.com/Kenanakn0/pulsecraft/server/internal/realtime"
)

// shortRangeThreshold: bu süreden kısa aralıklar ham `metrics` tablosundan,
// daha uzun aralıklar `metrics_1m` özet görünümünden okunur.
const shortRangeThreshold = 3 * time.Hour

// metricSample: agent'ın gönderdiği bir örnek. Alan adları/JSON etiketleri
// agent/internal/collector.Sample ile BİREBİR aynı tutulmalı — bu, iki ayrı
// modül (agent, server) arasındaki JSON "sözleşmesi".
type metricSample struct {
	Time         time.Time `json:"time"`
	CPUPercent   float64   `json:"cpu_percent"`
	MemPercent   float64   `json:"mem_percent"`
	MemUsedBytes uint64    `json:"mem_used_bytes"`
	DiskPercent  float64   `json:"disk_percent"`
	NetRxBps     int64     `json:"net_rx_bps"`
	NetTxBps     int64     `json:"net_tx_bps"`
	Load1        *float64  `json:"load1,omitempty"`
}

type metricsRequest struct {
	Samples []metricSample `json:"samples"`
}

// handleIngestMetrics: Authorization: Bearer <key> ile kimlik doğrular,
// samples'ı doğrular, toplu insert yapar ve node'un last_seen_at'ini günceller.
func (a *API) handleIngestMetrics(w http.ResponseWriter, r *http.Request) {
	apiKey, ok := bearerToken(r)
	if !ok {
		http.Error(w, "Authorization: Bearer <key> gerekli", http.StatusUnauthorized)
		return
	}

	nodeID, err := a.authenticateNode(r.Context(), apiKey)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "geçersiz api key", http.StatusUnauthorized)
			return
		}
		slog.Error("node doğrulanamadı", "err", err)
		http.Error(w, "sunucu hatası", http.StatusInternalServerError)
		return
	}

	var req metricsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "geçersiz istek gövdesi", http.StatusBadRequest)
		return
	}
	if len(req.Samples) == 0 {
		http.Error(w, "samples boş olamaz", http.StatusBadRequest)
		return
	}

	if err := a.insertSamples(r.Context(), nodeID, req.Samples); err != nil {
		slog.Error("metrikler kaydedilemedi", "err", err)
		http.Error(w, "sunucu hatası", http.StatusInternalServerError)
		return
	}

	if _, err := a.DB.Exec(r.Context(),
		`UPDATE nodes SET last_seen_at = now() WHERE id = $1`, nodeID); err != nil {
		// Metrikler zaten kaydedildi; last_seen_at güncellemesi başarısız olsa
		// bile isteği başarısız saymaya değmez, sadece logluyoruz.
		slog.Error("last_seen_at güncellenemedi", "err", err)
	}

	// Alarm değerlendirmesi: istemci bağlantıyı kesse bile yarım kalmasın diye
	// iptal edilmeyen bir context kullanıyoruz (context.WithoutCancel, Go 1.21+).
	bgCtx := context.WithoutCancel(r.Context())

	alertSamples := make([]alerting.Sample, len(req.Samples))
	metricEvents := make([]realtime.MetricEvent, len(req.Samples))
	for i, s := range req.Samples {
		alertSamples[i] = alerting.Sample{
			Time:        s.Time,
			CPUPercent:  s.CPUPercent,
			MemPercent:  s.MemPercent,
			DiskPercent: s.DiskPercent,
		}
		metricEvents[i] = realtime.MetricEvent{
			NodeID: nodeID, Time: s.Time,
			CPUPercent: s.CPUPercent, MemPercent: s.MemPercent, MemUsedBytes: s.MemUsedBytes,
			DiskPercent: s.DiskPercent, NetRxBps: s.NetRxBps, NetTxBps: s.NetTxBps, Load1: s.Load1,
		}
	}
	a.Pub.PublishMetrics(bgCtx, metricEvents)
	a.Engine.Evaluate(bgCtx, nodeID, alertSamples)

	slog.Info("metrikler alındı", "node_id", nodeID, "count", len(req.Samples))
	w.WriteHeader(http.StatusAccepted)
}

// bearerToken: Authorization başlığından "Bearer <token>" formatındaki
// token'ı çıkarır.
func bearerToken(r *http.Request) (string, bool) {
	header := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) {
		return "", false
	}
	return strings.TrimPrefix(header, prefix), true
}

// authenticateNode: verilen API key'in hash'ini alıp aktif bir node'a ait
// olup olmadığını kontrol eder, node id'sini döndürür.
func (a *API) authenticateNode(ctx context.Context, apiKey string) (string, error) {
	hash := hashAPIKey(apiKey)

	var nodeID string
	err := a.DB.QueryRow(ctx,
		`SELECT id FROM nodes WHERE api_key_hash = $1 AND is_active = true`,
		hash,
	).Scan(&nodeID)
	if err != nil {
		return "", err
	}
	return nodeID, nil
}

// insertSamples: samples'ı pgx.CopyFrom ile TEK bir toplu (batch) işlemde
// ekler — PostgreSQL'in COPY protokolünü kullanır, satır satır INSERT'ten
// çok daha hızlıdır (C#'taki SqlBulkCopy'nin karşılığı).
func (a *API) insertSamples(ctx context.Context, nodeID string, samples []metricSample) error {
	rows := make([][]any, len(samples))
	for i, s := range samples {
		rows[i] = []any{
			s.Time, nodeID, s.CPUPercent, s.MemPercent, s.MemUsedBytes,
			s.DiskPercent, s.NetRxBps, s.NetTxBps, s.Load1,
		}
	}

	_, err := a.DB.CopyFrom(ctx,
		pgx.Identifier{"metrics"},
		[]string{
			"time", "node_id", "cpu_percent", "mem_percent", "mem_used_bytes",
			"disk_percent", "net_rx_bps", "net_tx_bps", "load1",
		},
		pgx.CopyFromRows(rows),
	)
	return err
}

// rawPoint: `metrics` tablosundan (ham veri) dönen bir nokta.
type rawPoint struct {
	Time         time.Time `json:"time"`
	CPUPercent   float64   `json:"cpu_percent"`
	MemPercent   float64   `json:"mem_percent"`
	MemUsedBytes uint64    `json:"mem_used_bytes"`
	DiskPercent  float64   `json:"disk_percent"`
	NetRxBps     int64     `json:"net_rx_bps"`
	NetTxBps     int64     `json:"net_tx_bps"`
	Load1        *float64  `json:"load1,omitempty"`
}

// aggPoint: `metrics_1m` özet görünümünden (1 dakikalık ortalama/maksimum)
// dönen bir nokta.
type aggPoint struct {
	Time     time.Time `json:"time"`
	CPUAvg   float64   `json:"cpu_avg"`
	CPUMax   float64   `json:"cpu_max"`
	MemAvg   float64   `json:"mem_avg"`
	MemMax   float64   `json:"mem_max"`
	DiskAvg  float64   `json:"disk_avg"`
	NetRxAvg float64   `json:"net_rx_avg"`
	NetTxAvg float64   `json:"net_tx_avg"`
}

// metricsRangeResponse: GET /api/v1/nodes/{id}/metrics yanıtı.
type metricsRangeResponse struct {
	Resolution string    `json:"resolution"` // "raw" ya da "1m"
	From       time.Time `json:"from"`
	To         time.Time `json:"to"`
	Points     any       `json:"points"`
}

// handleGetNodeMetrics: aralık kısaysa ham metrics tablosundan, uzunsa
// metrics_1m özet görünümünden okur.
func (a *API) handleGetNodeMetrics(w http.ResponseWriter, r *http.Request) {
	nodeID := chi.URLParam(r, "id")

	from, to, err := parseRange(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	var resp metricsRangeResponse
	resp.From, resp.To = from, to

	if to.Sub(from) <= shortRangeThreshold {
		points, err := a.queryRawMetrics(r.Context(), nodeID, from, to)
		if err != nil {
			slog.Error("ham metrik sorgusu başarısız", "err", err)
			http.Error(w, "sunucu hatası", http.StatusInternalServerError)
			return
		}
		resp.Resolution = "raw"
		resp.Points = points
	} else {
		points, err := a.queryAggregatedMetrics(r.Context(), nodeID, from, to)
		if err != nil {
			slog.Error("özet metrik sorgusu başarısız", "err", err)
			http.Error(w, "sunucu hatası", http.StatusInternalServerError)
			return
		}
		resp.Resolution = "1m"
		resp.Points = points
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// parseRange: "from"/"to" query parametrelerini (RFC3339) ayrıştırır;
// verilmemişse son 1 saati varsayılan alır.
func parseRange(r *http.Request) (from, to time.Time, err error) {
	now := time.Now().UTC()
	from, to = now.Add(-1*time.Hour), now

	if v := r.URL.Query().Get("from"); v != "" {
		if from, err = time.Parse(time.RFC3339, v); err != nil {
			return time.Time{}, time.Time{}, fmt.Errorf("geçersiz 'from' (RFC3339 bekleniyor): %w", err)
		}
	}
	if v := r.URL.Query().Get("to"); v != "" {
		if to, err = time.Parse(time.RFC3339, v); err != nil {
			return time.Time{}, time.Time{}, fmt.Errorf("geçersiz 'to' (RFC3339 bekleniyor): %w", err)
		}
	}
	if !to.After(from) {
		return time.Time{}, time.Time{}, fmt.Errorf("'to', 'from'dan sonra olmalı")
	}
	return from, to, nil
}

func (a *API) queryRawMetrics(ctx context.Context, nodeID string, from, to time.Time) ([]rawPoint, error) {
	rows, err := a.DB.Query(ctx,
		`SELECT time, cpu_percent, mem_percent, mem_used_bytes, disk_percent, net_rx_bps, net_tx_bps, load1
		 FROM metrics WHERE node_id = $1 AND time BETWEEN $2 AND $3 ORDER BY time`,
		nodeID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	points := []rawPoint{}
	for rows.Next() {
		var p rawPoint
		if err := rows.Scan(&p.Time, &p.CPUPercent, &p.MemPercent, &p.MemUsedBytes,
			&p.DiskPercent, &p.NetRxBps, &p.NetTxBps, &p.Load1); err != nil {
			return nil, err
		}
		points = append(points, p)
	}
	return points, rows.Err()
}

func (a *API) queryAggregatedMetrics(ctx context.Context, nodeID string, from, to time.Time) ([]aggPoint, error) {
	rows, err := a.DB.Query(ctx,
		`SELECT bucket, cpu_avg, cpu_max, mem_avg, mem_max, disk_avg, net_rx_avg, net_tx_avg
		 FROM metrics_1m WHERE node_id = $1 AND bucket BETWEEN $2 AND $3 ORDER BY bucket`,
		nodeID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	points := []aggPoint{}
	for rows.Next() {
		var p aggPoint
		if err := rows.Scan(&p.Time, &p.CPUAvg, &p.CPUMax, &p.MemAvg, &p.MemMax,
			&p.DiskAvg, &p.NetRxAvg, &p.NetTxAvg); err != nil {
			return nil, err
		}
		points = append(points, p)
	}
	return points, rows.Err()
}
