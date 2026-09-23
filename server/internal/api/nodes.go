package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"
)

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
	rows, err := a.DB.Query(r.Context(),
		`SELECT id, name, hostname, os, is_active, last_seen_at, created_at
		 FROM nodes ORDER BY created_at DESC`)
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
		if err := rows.Scan(&n.ID, &n.Name, &n.Hostname, &n.OS, &n.IsActive, &lastSeen, &createdAt); err != nil {
			slog.Error("node satırı okunamadı", "err", err)
			http.Error(w, "sunucu hatası", http.StatusInternalServerError)
			return
		}
		n.CreatedAt = createdAt.Format(time.RFC3339)
		if lastSeen != nil {
			s := lastSeen.Format(time.RFC3339)
			n.LastSeenAt = &s
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
