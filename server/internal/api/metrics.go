package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/Kenanakn0/pulsecraft/server/internal/alerting"
	"github.com/Kenanakn0/pulsecraft/server/internal/realtime"
)

// shortRangeThreshold: shorter ranges read raw metrics, longer ones the 1-minute aggregate.
const shortRangeThreshold = 3 * time.Hour

// maxSamplesPerRequest leaves ample room above the agent's 1000-sample buffer.
const maxSamplesPerRequest = 5000

// metricSample must match agent/internal/collector.Sample field by field: it is the JSON contract
// between the two modules.
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
	// Hostname is only sent when the agent is configured with one (never an automatically detected name).
	Hostname *string        `json:"hostname"`
	Samples  []metricSample `json:"samples"`
}

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
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			http.Error(w, "istek gövdesi çok büyük", http.StatusRequestEntityTooLarge)
			return
		}
		http.Error(w, "geçersiz istek gövdesi", http.StatusBadRequest)
		return
	}
	if len(req.Samples) == 0 {
		http.Error(w, "samples boş olamaz", http.StatusBadRequest)
		return
	}
	if len(req.Samples) > maxSamplesPerRequest {
		http.Error(w, fmt.Sprintf("istek başına en fazla %d örnek gönderilebilir", maxSamplesPerRequest), http.StatusRequestEntityTooLarge)
		return
	}

	inserted, err := a.insertSamples(r.Context(), nodeID, req.Samples)
	if err != nil {
		slog.Error("metrikler kaydedilemedi", "err", err)
		http.Error(w, "sunucu hatası", http.StatusInternalServerError)
		return
	}
	if skipped := int64(len(req.Samples)) - inserted; skipped > 0 {
		// Expected after an agent retry: informational, not an error.
		slog.Info("mükerrer örnekler atlandı", "node_id", nodeID, "gelen", len(req.Samples), "atlanan", skipped)
	}

	// An invalid hostname does not reject the samples; it is ignored (nil keeps the stored value).
	var hostname *string
	if req.Hostname != nil {
		if h, err := normalizeHostname(*req.Hostname); err != nil {
			slog.Warn("geçersiz hostname yok sayıldı", "node_id", nodeID, "err", err)
		} else if h != "" {
			hostname = &h
		}
	}

	if _, err := a.DB.Exec(r.Context(),
		`UPDATE nodes SET last_seen_at = now(), hostname = COALESCE($2, hostname) WHERE id = $1`,
		nodeID, hostname); err != nil {
		// The samples are already stored; a failed last_seen_at update is not worth failing the request.
		slog.Error("last_seen_at güncellenemedi", "err", err)
	}

	// Alert evaluation must not be cut short when the client disconnects.
	bgCtx := context.WithoutCancel(r.Context())

	alertSamples := make([]alerting.Sample, len(req.Samples))
	newest := 0
	for i, s := range req.Samples {
		alertSamples[i] = alerting.Sample{
			Time:        s.Time,
			CPUPercent:  s.CPUPercent,
			MemPercent:  s.MemPercent,
			DiskPercent: s.DiskPercent,
		}
		if s.Time.After(req.Samples[newest].Time) {
			newest = i
		}
	}

	// Broadcast only the newest sample per request. After an outage the agent may flush hundreds of samples
	// at once; broadcasting them all would overflow WebSocket client queues and drop healthy clients. History
	// is read over REST, and the alert engine still evaluates every sample.
	s := req.Samples[newest]
	a.Pub.PublishMetrics([]realtime.MetricEvent{{
		NodeID: nodeID, Time: s.Time,
		CPUPercent: s.CPUPercent, MemPercent: s.MemPercent, MemUsedBytes: s.MemUsedBytes,
		DiskPercent: s.DiskPercent, NetRxBps: s.NetRxBps, NetTxBps: s.NetTxBps, Load1: s.Load1,
	}})
	a.Engine.Evaluate(bgCtx, nodeID, alertSamples)

	slog.Info("metrikler alındı", "node_id", nodeID, "count", len(req.Samples))
	w.WriteHeader(http.StatusAccepted)
}

func bearerToken(r *http.Request) (string, bool) {
	header := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) {
		return "", false
	}
	return strings.TrimPrefix(header, prefix), true
}

// authenticateNode looks up the node by the SHA-256 hash of the API key.
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

// insertSamplesSQL writes all samples in one query: each column arrives as an array parameter and unnest
// turns them into rows. COPY was replaced because it cannot skip conflicts.
//
// ON CONFLICT DO NOTHING is deliberately target-less: duplicates hitting the (node_id, time) unique index
// (an agent retry, or the same timestamp twice in one request) are skipped, and the query still works on
// older databases without that index (where duplicates are simply not prevented).
const insertSamplesSQL = `
INSERT INTO metrics (time, node_id, cpu_percent, mem_percent, mem_used_bytes,
                     disk_percent, net_rx_bps, net_tx_bps, load1)
SELECT s.t, $1::uuid, s.cpu, s.mem, s.mem_used, s.disk, s.rx, s.tx, s.load1
FROM unnest($2::timestamptz[], $3::float8[], $4::float8[], $5::int8[],
            $6::float8[], $7::int8[], $8::int8[], $9::float8[])
     AS s(t, cpu, mem, mem_used, disk, rx, tx, load1)
ON CONFLICT DO NOTHING`

// insertSamples returns the number of rows actually inserted (duplicates excluded).
func (a *API) insertSamples(ctx context.Context, nodeID string, samples []metricSample) (int64, error) {
	n := len(samples)
	var (
		times           = make([]time.Time, n)
		cpu, mem, disk  = make([]float64, n), make([]float64, n), make([]float64, n)
		memUsed, rx, tx = make([]int64, n), make([]int64, n), make([]int64, n)
		load1           = make([]*float64, n) // may be NULL
	)
	for i, s := range samples {
		times[i], cpu[i], mem[i], disk[i] = s.Time, s.CPUPercent, s.MemPercent, s.DiskPercent
		memUsed[i], rx[i], tx[i], load1[i] = int64(s.MemUsedBytes), s.NetRxBps, s.NetTxBps, s.Load1
	}

	tag, err := a.DB.Exec(ctx, insertSamplesSQL, nodeID, times, cpu, mem, memUsed, disk, rx, tx, load1)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

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

type metricsRangeResponse struct {
	Resolution string    `json:"resolution"`
	From       time.Time `json:"from"`
	To         time.Time `json:"to"`
	Points     any       `json:"points"`
}

func (a *API) handleGetNodeMetrics(w http.ResponseWriter, r *http.Request) {
	nodeID := chi.URLParam(r, "id")

	from, to, err := resolveRange(r.URL.Query(), time.Now().UTC())
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	var resp metricsRangeResponse
	resp.From, resp.To = from, to

	if to.Sub(from) <= shortRangeThreshold {
		points, err := a.queryRawMetrics(r.Context(), nodeID, from, to)
		if err != nil {
			a.writeDBError(w, "ham metrik sorgusu başarısız", err)
			return
		}
		resp.Resolution = "raw"
		resp.Points = points
	} else {
		points, err := a.queryAggregatedMetrics(r.Context(), nodeID, from, to)
		if err != nil {
			a.writeDBError(w, "özet metrik sorgusu başarısız", err)
			return
		}
		resp.Resolution = "1m"
		resp.Points = points
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

const (
	minLastRange = time.Minute
	maxLastRange = 30 * 24 * time.Hour // same as the raw data retention
)

// resolveRange accepts one of two forms. last=15m|1h|… (a Go duration) builds the window from the SERVER
// clock, so a wrong browser clock cannot shift it; the UI uses this. from/to (RFC 3339) is an absolute
// range. Without either, the last hour. now is a parameter for tests.
func resolveRange(q url.Values, now time.Time) (from, to time.Time, err error) {
	if last := q.Get("last"); last != "" {
		if q.Get("from") != "" || q.Get("to") != "" {
			return time.Time{}, time.Time{}, errors.New("'last' ile 'from'/'to' birlikte kullanılamaz")
		}
		d, perr := time.ParseDuration(last)
		if perr != nil {
			return time.Time{}, time.Time{}, fmt.Errorf("geçersiz 'last' (15m, 1h, 24h gibi bir süre bekleniyor): %w", perr)
		}
		if d < minLastRange || d > maxLastRange {
			return time.Time{}, time.Time{}, fmt.Errorf("'last' %s ile %s arasında olmalı", minLastRange, maxLastRange)
		}
		return now.Add(-d), now, nil
	}

	from, to = now.Add(-1*time.Hour), now
	if v := q.Get("from"); v != "" {
		if from, err = time.Parse(time.RFC3339, v); err != nil {
			return time.Time{}, time.Time{}, fmt.Errorf("geçersiz 'from' (RFC3339 bekleniyor): %w", err)
		}
	}
	if v := q.Get("to"); v != "" {
		if to, err = time.Parse(time.RFC3339, v); err != nil {
			return time.Time{}, time.Time{}, fmt.Errorf("geçersiz 'to' (RFC3339 bekleniyor): %w", err)
		}
	}
	if !to.After(from) {
		return time.Time{}, time.Time{}, errors.New("'to', 'from'dan sonra olmalı")
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
