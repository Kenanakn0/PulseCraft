package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/Kenanakn0/pulsecraft/server/internal/auth"
	"github.com/Kenanakn0/pulsecraft/server/internal/realtime"
)

var (
	validMetrics    = []string{"cpu_percent", "mem_percent", "disk_percent"}
	validOperators  = []string{">", ">=", "<", "<="}
	validSeverities = []string{"info", "warning", "critical"}
)

// ruleRequest: POST/PUT /api/v1/alert-rules gövdesi.
type ruleRequest struct {
	Name            string  `json:"name"`
	NodeID          *string `json:"node_id"` // null = tüm sunucular
	Metric          string  `json:"metric"`
	Operator        string  `json:"operator"`
	Threshold       float64 `json:"threshold"`
	DurationSeconds int     `json:"duration_seconds"`
	Severity        string  `json:"severity"`
	Enabled         *bool   `json:"enabled"`
}

// normalize: varsayılanları uygular ve alanları doğrular. Hata mesajı boşsa geçerli.
func (r *ruleRequest) normalize() string {
	if r.Severity == "" {
		r.Severity = "warning"
	}
	if r.Enabled == nil {
		enabled := true
		r.Enabled = &enabled
	}
	switch {
	case r.Name == "":
		return "name zorunlu"
	case !slices.Contains(validMetrics, r.Metric):
		return "metric şunlardan biri olmalı: cpu_percent, mem_percent, disk_percent"
	case !slices.Contains(validOperators, r.Operator):
		return "operator şunlardan biri olmalı: >, >=, <, <="
	case !slices.Contains(validSeverities, r.Severity):
		return "severity şunlardan biri olmalı: info, warning, critical"
	case r.DurationSeconds < 0:
		return "duration_seconds negatif olamaz"
	}
	return ""
}

// AlertRule: kural yanıtı.
type AlertRule struct {
	ID              int64     `json:"id"`
	Name            string    `json:"name"`
	NodeID          *string   `json:"node_id"`
	Metric          string    `json:"metric"`
	Operator        string    `json:"operator"`
	Threshold       float64   `json:"threshold"`
	DurationSeconds int       `json:"duration_seconds"`
	Severity        string    `json:"severity"`
	Enabled         bool      `json:"enabled"`
	CreatedAt       time.Time `json:"created_at"`
}

func (a *API) handleCreateRule(w http.ResponseWriter, r *http.Request) {
	var req ruleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "geçersiz istek gövdesi", http.StatusBadRequest)
		return
	}
	if msg := req.normalize(); msg != "" {
		http.Error(w, msg, http.StatusBadRequest)
		return
	}

	var rule AlertRule
	err := a.DB.QueryRow(r.Context(),
		`INSERT INTO alert_rules (name, node_id, metric, operator, threshold, duration_seconds, severity, enabled)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 RETURNING id, name, node_id, metric, operator, threshold, duration_seconds, severity, enabled, created_at`,
		req.Name, req.NodeID, req.Metric, req.Operator, req.Threshold, req.DurationSeconds, req.Severity, *req.Enabled,
	).Scan(&rule.ID, &rule.Name, &rule.NodeID, &rule.Metric, &rule.Operator, &rule.Threshold,
		&rule.DurationSeconds, &rule.Severity, &rule.Enabled, &rule.CreatedAt)
	if err != nil {
		a.writeDBError(w, "kural eklenemedi", err)
		return
	}

	a.refreshEngine(r.Context())
	writeJSON(w, http.StatusCreated, rule)
}

func (a *API) handleListRules(w http.ResponseWriter, r *http.Request) {
	rows, err := a.DB.Query(r.Context(),
		`SELECT id, name, node_id, metric, operator, threshold, duration_seconds, severity, enabled, created_at
		 FROM alert_rules ORDER BY id`)
	if err != nil {
		a.writeDBError(w, "kurallar okunamadı", err)
		return
	}
	defer rows.Close()

	rules := []AlertRule{}
	for rows.Next() {
		var rule AlertRule
		if err := rows.Scan(&rule.ID, &rule.Name, &rule.NodeID, &rule.Metric, &rule.Operator, &rule.Threshold,
			&rule.DurationSeconds, &rule.Severity, &rule.Enabled, &rule.CreatedAt); err != nil {
			a.writeDBError(w, "kural satırı okunamadı", err)
			return
		}
		rules = append(rules, rule)
	}
	if err := rows.Err(); err != nil {
		a.writeDBError(w, "kurallar okunamadı", err)
		return
	}
	writeJSON(w, http.StatusOK, rules)
}

func (a *API) handleUpdateRule(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Error(w, "geçersiz id", http.StatusBadRequest)
		return
	}

	var req ruleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "geçersiz istek gövdesi", http.StatusBadRequest)
		return
	}
	if msg := req.normalize(); msg != "" {
		http.Error(w, msg, http.StatusBadRequest)
		return
	}

	var rule AlertRule
	err = a.DB.QueryRow(r.Context(),
		`UPDATE alert_rules
		 SET name = $2, node_id = $3, metric = $4, operator = $5, threshold = $6,
		     duration_seconds = $7, severity = $8, enabled = $9
		 WHERE id = $1
		 RETURNING id, name, node_id, metric, operator, threshold, duration_seconds, severity, enabled, created_at`,
		id, req.Name, req.NodeID, req.Metric, req.Operator, req.Threshold, req.DurationSeconds, req.Severity, *req.Enabled,
	).Scan(&rule.ID, &rule.Name, &rule.NodeID, &rule.Metric, &rule.Operator, &rule.Threshold,
		&rule.DurationSeconds, &rule.Severity, &rule.Enabled, &rule.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "kural bulunamadı", http.StatusNotFound)
			return
		}
		a.writeDBError(w, "kural güncellenemedi", err)
		return
	}

	// Önce motorun kural önbelleği yenilenir (devre dışı/kapsamı değişen kural artık değerlendirilmez,
	// arada yeni alarm açılamaz), SONRA artık geçerli olmayan aktif alarmlar çözülür.
	a.refreshEngine(r.Context())
	a.resolveStaleAlerts(r.Context(), rule)
	writeJSON(w, http.StatusOK, rule)
}

func (a *API) handleDeleteRule(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Error(w, "geçersiz id", http.StatusBadRequest)
		return
	}

	// Silmeden ÖNCE aktif alarmlar çözülür ve "resolved" olayı yayınlanır: kural silinince alarm
	// satırları cascade ile gider, sonradan hangi alarmların açık olduğunu öğrenmek mümkün olmazdı.
	if _, err := a.Engine.ResolveRuleAlerts(r.Context(), id, nil); err != nil {
		a.writeDBError(w, "kuralın alarmları çözülemedi", err)
		return
	}

	tag, err := a.DB.Exec(r.Context(), `DELETE FROM alert_rules WHERE id = $1`, id)
	if err != nil {
		a.writeDBError(w, "kural silinemedi", err)
		return
	}
	if tag.RowsAffected() == 0 {
		http.Error(w, "kural bulunamadı", http.StatusNotFound)
		return
	}

	a.refreshEngine(r.Context())
	// Alarm satırları (geçmiş dahil) cascade ile silindi: açık istemciler o kurala ait satırları atsın.
	a.Pub.PublishRuleDeleted(id)
	w.WriteHeader(http.StatusNoContent)
}

// Alert: GET /api/v1/alerts yanıtındaki bir alarm.
type Alert struct {
	ID             int64      `json:"id"`
	RuleID         int64      `json:"rule_id"`
	RuleName       string     `json:"rule_name"`
	Severity       string     `json:"severity"`
	Metric         string     `json:"metric"`
	Operator       string     `json:"operator"`
	Threshold      float64    `json:"threshold"`
	NodeID         string     `json:"node_id"`
	NodeName       string     `json:"node_name"`
	Status         string     `json:"status"`
	TriggerValue   float64    `json:"trigger_value"`
	TriggeredAt    time.Time  `json:"triggered_at"`
	AcknowledgedAt *time.Time `json:"acknowledged_at"`
	AcknowledgedBy *string    `json:"acknowledged_by"` // görünen ad; incelemeye alınmadıysa null
	ResolvedAt     *time.Time `json:"resolved_at"`
}

// handleListAlerts: ?status=open|acknowledged|resolved ile filtrelenebilir.
func (a *API) handleListAlerts(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	if status != "" && !slices.Contains([]string{"open", "acknowledged", "resolved"}, status) {
		http.Error(w, "status: open, acknowledged veya resolved olmalı", http.StatusBadRequest)
		return
	}

	rows, err := a.DB.Query(r.Context(),
		`SELECT a.id, a.rule_id, r.name, r.severity, r.metric, r.operator, r.threshold,
		        a.node_id, n.name, a.status, a.trigger_value,
		        a.triggered_at, a.acknowledged_at, u.display_name, a.resolved_at
		 FROM alerts a
		 JOIN alert_rules r ON r.id = a.rule_id
		 JOIN nodes n ON n.id = a.node_id
		 LEFT JOIN users u ON u.id = a.acknowledged_by
		 WHERE ($1::text = '' OR a.status = $1::text)
		 ORDER BY a.triggered_at DESC
		 LIMIT 200`, status)
	if err != nil {
		a.writeDBError(w, "alarmlar okunamadı", err)
		return
	}
	defer rows.Close()

	alerts := []Alert{}
	for rows.Next() {
		var al Alert
		if err := rows.Scan(&al.ID, &al.RuleID, &al.RuleName, &al.Severity, &al.Metric, &al.Operator,
			&al.Threshold, &al.NodeID, &al.NodeName, &al.Status,
			&al.TriggerValue, &al.TriggeredAt, &al.AcknowledgedAt, &al.AcknowledgedBy, &al.ResolvedAt); err != nil {
			a.writeDBError(w, "alarm satırı okunamadı", err)
			return
		}
		alerts = append(alerts, al)
	}
	if err := rows.Err(); err != nil {
		a.writeDBError(w, "alarmlar okunamadı", err)
		return
	}
	writeJSON(w, http.StatusOK, alerts)
}

// handleAckAlert: "İncelemeye aldım" — sadece 'open' bir alarm 'acknowledged'
// olabilir. Güncelleme tek atomik UPDATE'tir; iki kişi aynı anda bassa
// yalnızca biri satırı günceller, diğeri 409 alır. İncelemeye alan kullanıcı
// (oturumdaki kullanıcı) acknowledged_by'a yazılır; yanıt ve WS olayı, o
// kullanıcının görünen adını DB'den okuyarak taşır.
func (a *API) handleAckAlert(w http.ResponseWriter, r *http.Request) {
	claims, ok := auth.ClaimsFromContext(r.Context())
	if !ok {
		http.Error(w, "oturum gerekli", http.StatusUnauthorized)
		return
	}
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Error(w, "geçersiz id", http.StatusBadRequest)
		return
	}

	var ev realtime.AlertEvent
	err = a.DB.QueryRow(r.Context(),
		`WITH u AS (
		     UPDATE alerts SET status = 'acknowledged', acknowledged_at = now(), acknowledged_by = $2
		     WHERE id = $1 AND status = 'open'
		     RETURNING id, rule_id, node_id, status, trigger_value, triggered_at, acknowledged_at, acknowledged_by
		 )
		 SELECT u.id, u.rule_id, r.name, r.severity, r.metric, r.operator, r.threshold,
		        u.node_id, n.name, u.status, u.trigger_value, u.triggered_at, u.acknowledged_at, usr.display_name
		 FROM u
		 JOIN alert_rules r ON r.id = u.rule_id
		 JOIN nodes n ON n.id = u.node_id
		 JOIN users usr ON usr.id = u.acknowledged_by`, id, claims.UserID,
	).Scan(&ev.AlertID, &ev.RuleID, &ev.RuleName, &ev.Severity, &ev.Metric, &ev.Operator, &ev.Threshold,
		&ev.NodeID, &ev.NodeName, &ev.Status, &ev.TriggerValue, &ev.TriggeredAt, &ev.AcknowledgedAt, &ev.AcknowledgedBy)

	// 23503 (foreign key): oturumdaki kullanıcı bu arada silinmiş. Token hâlâ
	// geçerli görünse de artık böyle bir kullanıcı yok; yeniden giriş istenir.
	// (writeDBError'daki genel 23503 eşlemesi "node bulunamadı" der, burada yanlış olurdu.)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23503" {
		http.SetCookie(w, a.expiredSessionCookie())
		http.Error(w, "oturumdaki kullanıcı artık yok, yeniden giriş yapın", http.StatusUnauthorized)
		return
	}
	if errors.Is(err, pgx.ErrNoRows) {
		var status string
		err := a.DB.QueryRow(r.Context(), `SELECT status FROM alerts WHERE id = $1`, id).Scan(&status)
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "alarm bulunamadı", http.StatusNotFound)
			return
		}
		if err != nil {
			a.writeDBError(w, "alarm okunamadı", err)
			return
		}
		http.Error(w, "alarm zaten '"+status+"' durumunda", http.StatusConflict)
		return
	}
	if err != nil {
		a.writeDBError(w, "alarm güncellenemedi", err)
		return
	}

	ev.Event = "acknowledged"
	a.Pub.PublishAlert(ev)
	writeJSON(w, http.StatusOK, ev)
}

// resolveStaleAlerts: güncellenen kuralın artık geçerli olmayan aktif alarmlarını çözer.
//   - Kural devre dışıysa: motor onu değerlendirmez, tüm aktif alarmları çözülür.
//   - Kural tek bir sunucuya daraltıldıysa: o sunucu DIŞINDAKİ aktif alarmlar çözülür.
//   - Kural tüm sunucular için etkinse: çözülecek bir şey yok (eşik/süre değişiklikleri sonraki
//     örnekte motor tarafından zaten değerlendirilir).
//
// Hata olursa kural güncellemesi geri alınmaz (yalnızca loglanır): alarmlar bir sonraki
// devre dışı bırakma/güncellemede yeniden denenir.
func (a *API) resolveStaleAlerts(ctx context.Context, rule AlertRule) {
	switch {
	case !rule.Enabled:
		// tümü
	case rule.NodeID != nil:
		// yalnızca kapsam dışındakiler
	default:
		return
	}
	var except *string
	if rule.Enabled {
		except = rule.NodeID
	}
	if _, err := a.Engine.ResolveRuleAlerts(ctx, rule.ID, except); err != nil {
		slog.Error("kuralın eski alarmları çözülemedi", "rule_id", rule.ID, "err", err)
	}
}

// refreshEngine: kural değişince motorun bellek cache'ini hemen yeniler.
func (a *API) refreshEngine(ctx context.Context) {
	if err := a.Engine.Refresh(ctx); err != nil {
		slog.Error("alarm motoru yenilenemedi", "err", err)
	}
}

// writeDBError: geçersiz UUID (22P02) ve olmayan node'a referans (23503) gibi
// istemci kaynaklı DB hatalarını 400'e, gerisini 500'e çevirir. errors.As,
// hata zincirinde belirli bir tipi arar — C#'taki
// catch (PostgresException ex) when (ex.SqlState == "22P02") karşılığı.
func (a *API) writeDBError(w http.ResponseWriter, msg string, err error) {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "22P02":
			http.Error(w, "geçersiz node_id (UUID bekleniyor)", http.StatusBadRequest)
			return
		case "23503":
			http.Error(w, "node_id ile eşleşen bir sunucu yok", http.StatusBadRequest)
			return
		}
	}
	slog.Error(msg, "err", err)
	http.Error(w, "sunucu hatası", http.StatusInternalServerError)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
