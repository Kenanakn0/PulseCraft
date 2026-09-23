package alerting

import (
	"context"
	"log/slog"
	"slices"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Rule: alert_rules tablosundaki bir kuralın bellekteki hali.
type Rule struct {
	ID              int64
	Name            string
	NodeID          *string // nil = tüm sunucular
	Metric          string
	Operator        string
	Threshold       float64
	DurationSeconds int
	Severity        string
}

// Sample: motorun değerlendirmek için ihtiyaç duyduğu alanlar. api paketinin
// metricSample tipini import etmemek için (döngüsel bağımlılık olmasın diye)
// burada ayrıca tanımlı.
type Sample struct {
	Time        time.Time
	CPUPercent  float64
	MemPercent  float64
	DiskPercent float64
}

func (s Sample) value(metric string) (float64, bool) {
	switch metric {
	case "cpu_percent":
		return s.CPUPercent, true
	case "mem_percent":
		return s.MemPercent, true
	case "disk_percent":
		return s.DiskPercent, true
	}
	return 0, false
}

// key: (kural, sunucu) çifti. Go'da struct'lar map anahtarı olabilir — C#'taki
// Dictionary<(long, string), ...> (ValueTuple anahtar) gibi.
type key struct {
	ruleID int64
	nodeID string
}

// Engine: kuralları bellekte tutar, gelen örnekleri değerlendirir, alarm açar/kapatır.
type Engine struct {
	db *pgxpool.Pool

	// mu, aşağıdaki alanları korur. Birden fazla agent aynı anda POST attığında
	// Evaluate eşzamanlı çağrılır; C#'taki lock (obj) { ... } karşılığı.
	mu          sync.Mutex
	rules       []Rule
	breachStart map[key]time.Time // eşik aşımının başladığı an (örnek zamanı)
	active      map[key]bool      // şu an açık/incelemede alarmı olan (kural, sunucu) çiftleri
}

func New(db *pgxpool.Pool) *Engine {
	return &Engine{
		db:          db,
		breachStart: make(map[key]time.Time),
		active:      make(map[key]bool),
	}
}

// Refresh: aktif kuralları ve açık alarmları DB'den yeniden yükler.
// DB sorguları kilit dışında yapılır, sadece sonuç değiştirilirken kilitlenir.
func (e *Engine) Refresh(ctx context.Context) error {
	rules, err := e.loadRules(ctx)
	if err != nil {
		return err
	}
	active, err := e.loadActiveAlerts(ctx)
	if err != nil {
		return err
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	e.rules = rules
	e.active = active

	// Silinmiş/devre dışı kurallara ait eşik aşımı kayıtlarını temizle.
	valid := make(map[int64]bool, len(rules))
	for _, r := range rules {
		valid[r.ID] = true
	}
	for k := range e.breachStart {
		if !valid[k.ruleID] {
			delete(e.breachStart, k)
		}
	}

	slog.Info("alarm kuralları yüklendi", "rules", len(rules), "active_alerts", len(active))
	return nil
}

// Run: interval aralığıyla kuralları yeniler; ctx iptal edilince durur.
func (e *Engine) Run(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := e.Refresh(ctx); err != nil {
				slog.Error("alarm kuralları yenilenemedi", "err", err)
			}
		}
	}
}

func (e *Engine) loadRules(ctx context.Context) ([]Rule, error) {
	rows, err := e.db.Query(ctx,
		`SELECT id, name, node_id, metric, operator, threshold, duration_seconds, severity
		 FROM alert_rules WHERE enabled = true`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rules []Rule
	for rows.Next() {
		var r Rule
		if err := rows.Scan(&r.ID, &r.Name, &r.NodeID, &r.Metric, &r.Operator,
			&r.Threshold, &r.DurationSeconds, &r.Severity); err != nil {
			return nil, err
		}
		rules = append(rules, r)
	}
	return rules, rows.Err()
}

func (e *Engine) loadActiveAlerts(ctx context.Context) (map[key]bool, error) {
	rows, err := e.db.Query(ctx,
		`SELECT rule_id, node_id FROM alerts WHERE status IN ('open', 'acknowledged')`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	active := make(map[key]bool)
	for rows.Next() {
		var k key
		if err := rows.Scan(&k.ruleID, &k.nodeID); err != nil {
			return nil, err
		}
		active[k] = true
	}
	return active, rows.Err()
}

// Evaluate: bir sunucudan gelen örnekleri, zaman sırasıyla tüm ilgili kurallara
// karşı değerlendirir. Süre (duration_seconds) hesabı duvar saati değil ÖRNEK
// zamanıyla yapılır: agent, sunucuya ulaşamadığı dönemin verisini toplu
// gönderdiğinde de doğru sonuç çıksın diye.
func (e *Engine) Evaluate(ctx context.Context, nodeID string, samples []Sample) {
	slices.SortFunc(samples, func(a, b Sample) int { return a.Time.Compare(b.Time) })

	e.mu.Lock()
	defer e.mu.Unlock()

	for _, s := range samples {
		for _, r := range e.rules {
			if r.NodeID != nil && *r.NodeID != nodeID {
				continue
			}
			value, ok := s.value(r.Metric)
			if !ok {
				continue
			}

			k := key{ruleID: r.ID, nodeID: nodeID}

			if breached(value, r.Operator, r.Threshold) {
				start, seen := e.breachStart[k]
				if !seen {
					start = s.Time
					e.breachStart[k] = start
				}
				needed := time.Duration(r.DurationSeconds) * time.Second
				if !e.active[k] && s.Time.Sub(start) >= needed {
					e.openAlert(ctx, r, nodeID, value, k)
				}
				continue
			}

			delete(e.breachStart, k)
			if e.active[k] {
				e.resolveAlert(ctx, r, nodeID, k)
			}
		}
	}
}

// openAlert: kilit tutulurken çağrılır. Partial unique index sayesinde aynı
// (kural, sunucu) için ikinci bir aktif alarm zaten açılamaz; ON CONFLICT
// DO NOTHING bu durumu hata saymadan yutar.
func (e *Engine) openAlert(ctx context.Context, r Rule, nodeID string, value float64, k key) {
	_, err := e.db.Exec(ctx,
		`INSERT INTO alerts (rule_id, node_id, trigger_value) VALUES ($1, $2, $3)
		 ON CONFLICT DO NOTHING`,
		r.ID, nodeID, value)
	if err != nil {
		slog.Error("alarm açılamadı", "rule_id", r.ID, "node_id", nodeID, "err", err)
		return // active işaretlenmez, sonraki örnekte tekrar denenir
	}
	e.active[k] = true
	slog.Warn("alarm açıldı", "rule", r.Name, "severity", r.Severity,
		"node_id", nodeID, "metric", r.Metric, "value", value, "threshold", r.Threshold)
}

func (e *Engine) resolveAlert(ctx context.Context, r Rule, nodeID string, k key) {
	_, err := e.db.Exec(ctx,
		`UPDATE alerts SET status = 'resolved', resolved_at = now()
		 WHERE rule_id = $1 AND node_id = $2 AND status IN ('open', 'acknowledged')`,
		r.ID, nodeID)
	if err != nil {
		slog.Error("alarm kapatılamadı", "rule_id", r.ID, "node_id", nodeID, "err", err)
		return
	}
	delete(e.active, k)
	slog.Info("alarm çözüldü", "rule", r.Name, "node_id", nodeID)
}

func breached(value float64, operator string, threshold float64) bool {
	switch operator {
	case ">":
		return value > threshold
	case ">=":
		return value >= threshold
	case "<":
		return value < threshold
	case "<=":
		return value <= threshold
	}
	return false
}
