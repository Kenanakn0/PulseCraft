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

type Rule struct {
	ID              int64
	Name            string
	NodeID          *string // nil = all servers
	Metric          string
	Operator        string
	Threshold       float64
	DurationSeconds int
	Severity        string
}

// Sample is defined here rather than importing the api package's type, to avoid an import cycle.
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

type key struct {
	ruleID int64
	nodeID string
}

type Engine struct {
	db  *pgxpool.Pool
	pub *realtime.Publisher

	// mu guards the fields below: Evaluate runs concurrently when several agents post at once.
	mu          sync.Mutex
	rules       []Rule
	breachStart map[key]time.Time // sample time when the threshold was first breached
	active      map[key]bool      // (rule, node) pairs with an open or acknowledged alert
}

func New(db *pgxpool.Pool, pub *realtime.Publisher) *Engine {
	return &Engine{
		db:          db,
		pub:         pub,
		breachStart: make(map[key]time.Time),
		active:      make(map[key]bool),
	}
}

// Refresh reloads rules and active alerts. Queries run outside the lock; only the swap is locked.
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

	// Forget breach starts of rules that were deleted or disabled.
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

// Evaluate checks the samples in time order against all matching rules. Durations use sample
// timestamps, not the wall clock, so a backlog sent after an outage is evaluated as it happened.
func (e *Engine) Evaluate(ctx context.Context, nodeID string, samples []Sample) {
	slices.SortFunc(samples, func(a, b Sample) int { return a.Time.Compare(b.Time) })

	events := e.evaluateLocked(ctx, nodeID, samples)

	// Publish after releasing the lock so network latency does not block other agents.
	for _, ev := range events {
		e.pub.PublishAlert(ev)
	}
}

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

// openAlert is called with the lock held. The partial unique index makes a second active alert for
// the same (rule, node) impossible; ON CONFLICT DO NOTHING turns that into "no row" instead of an error,
// and no event is produced. The node name is read in the same query so the event carries a full row.
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
		e.active[k] = true // already open (e.g. after a restart)
		return nil
	}
	if err != nil {
		slog.Error("alarm açılamadı", "rule_id", r.ID, "node_id", nodeID, "err", err)
		return nil // not marked active: retried on the next sample
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

// resolvedEventsSQL resolves active alerts and returns everything an event needs.
// $1 = rule id, $2 = node id or NULL (all nodes), $3 = true: every node except $2, false: only $2.
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

// resolvedByNodeSQL resolves all active alerts of node $1, across rules (used before deleting a node).
const resolvedByNodeSQL = `
WITH u AS (
    UPDATE alerts SET status = 'resolved', resolved_at = now()
    WHERE node_id = $1::uuid
      AND status IN ('open', 'acknowledged')
    RETURNING id, rule_id, node_id, trigger_value, triggered_at, acknowledged_at, acknowledged_by, resolved_at
)
SELECT u.id, u.rule_id, r.name, r.severity, r.metric, r.operator, r.threshold,
       u.node_id, n.name, u.trigger_value, u.triggered_at, u.acknowledged_at, usr.display_name, u.resolved_at
FROM u
JOIN alert_rules r ON r.id = u.rule_id
JOIN nodes n ON n.id = u.node_id
LEFT JOIN users usr ON usr.id = u.acknowledged_by
ORDER BY u.id`

func (e *Engine) queryResolved(ctx context.Context, ruleID int64, nodeID *string, except bool) ([]realtime.AlertEvent, error) {
	return e.queryResolvedSQL(ctx, resolvedEventsSQL, ruleID, nodeID, except)
}

func (e *Engine) queryResolvedSQL(ctx context.Context, sql string, args ...any) ([]realtime.AlertEvent, error) {
	rows, err := e.db.Query(ctx, sql, args...)
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

	delete(e.active, k) // cleared even if nothing was active in the DB
	if len(events) == 0 {
		return nil
	}
	slog.Info("alarm çözüldü", "rule", r.Name, "node_id", nodeID)
	return &events[0]
}

// ResolveRuleAlerts resolves a rule's active alerts and publishes "resolved" events. It is called when a
// rule is disabled or before it is deleted: the engine no longer evaluates such a rule, so its alerts
// would otherwise stay open forever. With exceptNodeID set, only alerts of other nodes are resolved (the
// rule was narrowed to that node). The engine state is cleared too, so a re-enabled rule can alert again.
func (e *Engine) ResolveRuleAlerts(ctx context.Context, ruleID int64, exceptNodeID *string) ([]realtime.AlertEvent, error) {
	e.mu.Lock()
	events, err := e.queryResolved(ctx, ruleID, exceptNodeID, true)
	if err == nil {
		for _, ev := range events {
			delete(e.active, key{ruleID: ruleID, nodeID: ev.NodeID})
		}
		// Also forget breach starts that have not opened an alert yet: otherwise, when the scope widens
		// again, a stale start time would count toward the duration and open an alert immediately.
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

// ResolveNodeAlerts resolves all active alerts of a node and publishes "resolved" events. It must run
// before the node is deleted: afterwards the cascade removes the rows and the open alerts cannot be found.
func (e *Engine) ResolveNodeAlerts(ctx context.Context, nodeID string) ([]realtime.AlertEvent, error) {
	e.mu.Lock()
	events, err := e.queryResolvedSQL(ctx, resolvedByNodeSQL, nodeID)
	if err == nil {
		for k := range e.active {
			if k.nodeID == nodeID {
				delete(e.active, k)
			}
		}
		for k := range e.breachStart {
			if k.nodeID == nodeID {
				delete(e.breachStart, k)
			}
		}
	}
	e.mu.Unlock()
	if err != nil {
		return nil, err
	}

	for _, ev := range events {
		e.pub.PublishAlert(ev)
	}
	if len(events) > 0 {
		slog.Info("sunucunun aktif alarmları çözüldü", "node_id", nodeID, "adet", len(events))
	}
	return events, nil
}
