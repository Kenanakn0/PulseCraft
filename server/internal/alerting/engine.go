package alerting

import (
	"context"
	"errors"
	"log/slog"
	"slices"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Kenanakn0/pulsecraft/server/internal/realtime"
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
	db  *pgxpool.Pool
	pub *realtime.Publisher

	// mu, aşağıdaki alanları korur. Birden fazla agent aynı anda POST attığında
	// Evaluate eşzamanlı çağrılır; C#'taki lock (obj) { ... } karşılığı.
	mu          sync.Mutex
	rules       []Rule
	breachStart map[key]time.Time // eşik aşımının başladığı an (örnek zamanı)
	active      map[key]bool      // şu an açık/incelemede alarmı olan (kural, sunucu) çiftleri
}

func New(db *pgxpool.Pool, pub *realtime.Publisher) *Engine {
	return &Engine{
		db:          db,
		pub:         pub,
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

	events := e.evaluateLocked(ctx, nodeID, samples)

	// Redis'e yayın, kilit bırakıldıktan sonra yapılır: ağ gecikmesi diğer
	// agent'ların değerlendirmesini bekletmesin.
	for _, ev := range events {
		e.pub.PublishAlert(ev)
	}
}

// evaluateLocked: kilidi kendi içinde alıp bırakır (defer sayesinde) ve
// oluşan alarm olaylarını döndürür.
func (e *Engine) evaluateLocked(ctx context.Context, nodeID string, samples []Sample) []realtime.AlertEvent {
	e.mu.Lock()
	defer e.mu.Unlock()

	var events []realtime.AlertEvent

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
					if ev := e.openAlert(ctx, r, nodeID, value, k); ev != nil {
						events = append(events, *ev)
					}
				}
				continue
			}

			delete(e.breachStart, k)
			if e.active[k] {
				if ev := e.resolveAlert(ctx, r, nodeID, k); ev != nil {
					events = append(events, *ev)
				}
			}
		}
	}
	return events
}

// openAlert: kilit tutulurken çağrılır. Partial unique index sayesinde aynı
// (kural, sunucu) için ikinci bir aktif alarm zaten açılamaz; ON CONFLICT
// DO NOTHING bu durumu hata saymadan yutar. Bu durumda RETURNING satır
// döndürmez (pgx.ErrNoRows) ve yeni bir olay üretilmez.
// Sunucu adı, olay istemcide REST'e gitmeden satır kurabilsin diye aynı sorguda okunur.
func (e *Engine) openAlert(ctx context.Context, r Rule, nodeID string, value float64, k key) *realtime.AlertEvent {
	var alertID int64
	var triggeredAt time.Time
	var nodeName string
	err := e.db.QueryRow(ctx,
		`WITH i AS (
		     INSERT INTO alerts (rule_id, node_id, trigger_value) VALUES ($1, $2, $3)
		     ON CONFLICT DO NOTHING
		     RETURNING id, node_id, triggered_at
		 )
		 SELECT i.id, i.triggered_at, n.name FROM i JOIN nodes n ON n.id = i.node_id`,
		r.ID, nodeID, value).Scan(&alertID, &triggeredAt, &nodeName)
	if errors.Is(err, pgx.ErrNoRows) {
		e.active[k] = true // zaten açık bir alarm var (ör. restart sonrası)
		return nil
	}
	if err != nil {
		slog.Error("alarm açılamadı", "rule_id", r.ID, "node_id", nodeID, "err", err)
		return nil // active işaretlenmez, sonraki örnekte tekrar denenir
	}

	e.active[k] = true
	slog.Warn("alarm açıldı", "rule", r.Name, "severity", r.Severity,
		"node_id", nodeID, "metric", r.Metric, "value", value, "threshold", r.Threshold)

	return &realtime.AlertEvent{
		Event: "opened", AlertID: alertID, RuleID: r.ID, RuleName: r.Name, NodeID: nodeID, NodeName: nodeName,
		Severity: r.Severity, Metric: r.Metric, Operator: r.Operator, Threshold: r.Threshold,
		TriggerValue: value, Status: "open", TriggeredAt: triggeredAt,
	}
}

// resolvedEventsSQL: aktif (open/acknowledged) alarmları 'resolved' yapar ve her biri için olayın
// ihtiyaç duyduğu TÜM alanları (kural, sunucu adı, varsa incelemeye alan kullanıcı) döndürür.
// $1 = kural id, $2 = sunucu id ya da NULL, $3 = true ise $2 dışındaki sunucular, false ise yalnızca $2.
// (NULL $2: kuralın tüm aktif alarmları.)
const resolvedEventsSQL = `
WITH u AS (
    UPDATE alerts SET status = 'resolved', resolved_at = now()
    WHERE rule_id = $1
      AND status IN ('open', 'acknowledged')
      AND ($2::uuid IS NULL OR (CASE WHEN $3::bool THEN node_id <> $2::uuid ELSE node_id = $2::uuid END))
    RETURNING id, rule_id, node_id, trigger_value, triggered_at, acknowledged_at, acknowledged_by, resolved_at
)
SELECT u.id, u.rule_id, r.name, r.severity, r.metric, r.operator, r.threshold,
       u.node_id, n.name, u.trigger_value, u.triggered_at, u.acknowledged_at, usr.display_name, u.resolved_at
FROM u
JOIN alert_rules r ON r.id = u.rule_id
JOIN nodes n ON n.id = u.node_id
LEFT JOIN users usr ON usr.id = u.acknowledged_by
ORDER BY u.id`

// queryResolved: resolvedEventsSQL'i çalıştırıp olayları kurar (yayınlamaz).
func (e *Engine) queryResolved(ctx context.Context, ruleID int64, nodeID *string, except bool) ([]realtime.AlertEvent, error) {
	rows, err := e.db.Query(ctx, resolvedEventsSQL, ruleID, nodeID, except)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []realtime.AlertEvent
	for rows.Next() {
		var ev realtime.AlertEvent
		var ackBy *string
		if err := rows.Scan(&ev.AlertID, &ev.RuleID, &ev.RuleName, &ev.Severity, &ev.Metric, &ev.Operator,
			&ev.Threshold, &ev.NodeID, &ev.NodeName, &ev.TriggerValue, &ev.TriggeredAt,
			&ev.AcknowledgedAt, &ackBy, &ev.ResolvedAt); err != nil {
			return nil, err
		}
		if ackBy != nil {
			ev.AcknowledgedBy = *ackBy
		}
		ev.Event, ev.Status = "resolved", "resolved"
		events = append(events, ev)
	}
	return events, rows.Err()
}

func (e *Engine) resolveAlert(ctx context.Context, r Rule, nodeID string, k key) *realtime.AlertEvent {
	events, err := e.queryResolved(ctx, r.ID, &nodeID, false)
	if err != nil {
		slog.Error("alarm kapatılamadı", "rule_id", r.ID, "node_id", nodeID, "err", err)
		return nil
	}

	delete(e.active, k) // DB'de aktif alarm yoksa da (zaten kapanmış) işaret temizlenir
	if len(events) == 0 {
		return nil
	}
	slog.Info("alarm çözüldü", "rule", r.Name, "node_id", nodeID)
	return &events[0]
}

// ResolveRuleAlerts: bir kuralın aktif alarmlarını çözer ve her biri için "resolved" olayı yayınlar.
// Kural devre dışı bırakılınca ya da silinmeden önce çağrılır: motor devre dışı kuralı artık
// değerlendirmediği için bu alarmlar aksi halde sonsuza dek "açık" kalırdı.
//
//	exceptNodeID == nil : kuralın TÜM aktif alarmları çözülür.
//	exceptNodeID != nil : yalnızca O SUNUCUNUN DIŞINDAKİ alarmlar çözülür (kural tek bir sunucuya
//	                      daraltıldıysa, kapsam dışında kalan sunucuların alarmları takılı kalmasın).
//
// Çözülen olayları döndürür. Motorun bellek durumu (active/breachStart) da temizlenir; böylece kural
// sonradan yeniden etkinleştirilirse yeni alarm normal şekilde açılabilir.
func (e *Engine) ResolveRuleAlerts(ctx context.Context, ruleID int64, exceptNodeID *string) ([]realtime.AlertEvent, error) {
	e.mu.Lock()
	events, err := e.queryResolved(ctx, ruleID, exceptNodeID, true)
	if err == nil {
		for _, ev := range events {
			delete(e.active, key{ruleID: ruleID, nodeID: ev.NodeID})
		}
		// Henüz alarm açmamış (süre dolmamış) eşik aşımı kayıtları da temizlenir: aksi halde kapsam
		// sonradan yeniden genişleyince, izlenmediği dönemden kalan eski başlangıç zamanı süre hesabına
		// girer ve alarm haksız yere hemen açılırdı.
		for k := range e.breachStart {
			if k.ruleID == ruleID && (exceptNodeID == nil || k.nodeID != *exceptNodeID) {
				delete(e.breachStart, k)
			}
		}
	}
	e.mu.Unlock()
	if err != nil {
		return nil, err
	}

	// Yayın kilit dışında (Publisher zaten kuyrukla çalışır, yine de kilidi kısa tutuyoruz).
	for _, ev := range events {
		e.pub.PublishAlert(ev)
	}
	if len(events) > 0 {
		slog.Info("kuralın aktif alarmları çözüldü", "rule_id", ruleID, "adet", len(events))
	}
	return events, nil
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
