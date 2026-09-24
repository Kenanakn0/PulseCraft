package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"math"
	"net/http"
	"time"
)

// onlineThreshold: last_seen_at bu süreden yeniyse node "çevrimiçi" sayılır.
// Karşılaştırma SUNUCUDA, veritabanının saatiyle (now() - last_seen_at) yapılır;
// tarayıcının saati yanlış olsa bile durum doğru görünür. Varsayılan agent
// aralığı 3 sn olduğundan 15 sn, birkaç kaçırılmış gönderime tolerans tanır.
const onlineThreshold = 15 * time.Second

// NodeLatest: bir node'un en son kaydedilmiş ölçümü (kartlarda anında değer
// gösterebilmek için; hiç ölçümü yoksa Node.Latest null'dır).
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

// Node: GET /api/v1/nodes yanıtında dönen alanlar. api_key_hash burada
// ASLA yer almaz — düz key sadece oluşturma anında bir kez gösterilir.
type Node struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Hostname   *string `json:"hostname"`
	OS         *string `json:"os"`
	IsActive   bool    `json:"is_active"`
	LastSeenAt *string `json:"last_seen_at"`
	CreatedAt  string  `json:"created_at"`

	// Online, sunucu saatiyle hesaplanır (bkz. onlineThreshold). LastSeenSecondsAgo
	// de sunucuda hesaplanır; hiç görülmemişse null'dır.
	Online             bool        `json:"online"`
	LastSeenSecondsAgo *float64    `json:"last_seen_seconds_ago"`
	Latest             *NodeLatest `json:"latest"`
}

// isOnline: son görülmeden bu yana geçen süreye (sn; hiç görülmediyse nil) göre
// node'un çevrimiçi olup olmadığını söyler.
func isOnline(secondsAgo *float64) bool {
	return secondsAgo != nil && *secondsAgo <= onlineThreshold.Seconds()
}

// createNodeRequest: POST /api/v1/nodes gövdesi.
type createNodeRequest struct {
	Name     string `json:"name"`
	Hostname string `json:"hostname"`
	OS       string `json:"os"`
}

// createNodeResponse: API key SADECE bu yanıtta düz metin olarak döner.
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
	if req.Name == "" {
		http.Error(w, "name zorunlu", http.StatusBadRequest)
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
	// LEFT JOIN LATERAL: her node için "en yeni tek ölçümü" ayrı bir alt sorguyla
	// alır (ix_metrics_node_time indeksi (node_id, time DESC) bunu ucuz kılar).
	// Ölçümü olmayan node'larda m.* sütunları NULL gelir.
	// EXTRACT(EPOCH ...): now() - last_seen_at farkını saniye olarak veritabanı saatiyle hesaplar.
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

		// LEFT JOIN'den gelen, NULL olabilen sütunlar için işaretçi (pointer) kullanılır.
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
			ago := math.Max(*age, 0) // saat oynamalarında eksi değer çıkmasın
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

// generateAPIKey: crypto/rand (kriptografik olarak güvenli rastgelelik) ile
// 32 baytlık rastgele değer üretip hex string'e çevirir. math/rand gizli
// değerler için ASLA kullanılmamalı — tahmin edilebilir.
func generateAPIKey() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// hashAPIKey: API key'in SHA-256 hash'ini hex string olarak döndürür.
// DB'de düz key değil, sadece bu hash saklanır.
func hashAPIKey(apiKey string) string {
	sum := sha256.Sum256([]byte(apiKey))
	return hex.EncodeToString(sum[:])
}
