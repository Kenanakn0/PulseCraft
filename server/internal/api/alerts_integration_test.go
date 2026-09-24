package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/Kenanakn0/pulsecraft/server/internal/alerting"
	"github.com/Kenanakn0/pulsecraft/server/internal/auth"
	"github.com/Kenanakn0/pulsecraft/server/internal/clientip"
	"github.com/Kenanakn0/pulsecraft/server/internal/realtime"
)

// Bu dosyadaki testler GERÇEK bir PostgreSQL/TimescaleDB ve Redis ister (alarm SQL'leri ve yayınlanan
// olaylar sahte bir nesneyle doğrulanamaz). Ortam değişkenleri yoksa atlanırlar; normal `go test ./...`
// etkilenmez. Şemanın yüklü olduğu, SAHTE verili bir prova veritabanına karşı çalıştırın:
//
//	PULSECRAFT_TEST_DATABASE_URL=postgres://...  PULSECRAFT_TEST_REDIS_URL=redis://...  go test ./internal/api -run Integration -v
//
// Testler kendi node/kural/kullanıcılarını oluşturur ve sonunda siler.

type integration struct {
	t       *testing.T
	api     *API
	router  http.Handler
	db      *pgxpool.Pool
	cookie  *http.Cookie
	userID  int64
	events  <-chan *redis.Message
}

func newIntegration(t *testing.T) *integration {
	t.Helper()
	dbURL, redisURL := os.Getenv("PULSECRAFT_TEST_DATABASE_URL"), os.Getenv("PULSECRAFT_TEST_REDIS_URL")
	if dbURL == "" || redisURL == "" {
		t.Skip("PULSECRAFT_TEST_DATABASE_URL / PULSECRAFT_TEST_REDIS_URL tanımlı değil")
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	db, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)

	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		t.Fatal(err)
	}
	rdb := redis.NewClient(opt)
	t.Cleanup(func() { _ = rdb.Close() })

	sub := rdb.Subscribe(ctx, realtime.ChannelAlerts)
	if _, err := sub.Receive(ctx); err != nil { // abonelik gerçekten kuruldu
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sub.Close() })

	pub := realtime.NewPublisher(rdb)
	go pub.Run(ctx)

	a := &API{
		DB:           db,
		Engine:       alerting.New(db, pub),
		Pub:          pub,
		Hub:          realtime.NewHub(nil),
		Tokens:       auth.NewTokenService(apiTestSecret, time.Hour),
		Denylist:     auth.NewDenylist(),
		LoginLimiter: auth.NewRateLimiter(10, time.Minute),
		ClientIP:     clientip.New(nil),
	}

	suffix := strconv.FormatInt(time.Now().UnixNano(), 36)
	var userID int64
	if err := db.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', 'Test Kullanici') RETURNING id`,
		"it-"+suffix+"@example.test").Scan(&userID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID) })

	token, claims, err := a.Tokens.Issue(auth.User{ID: userID, Email: "it@example.test", DisplayName: "Test Kullanici"})
	if err != nil {
		t.Fatal(err)
	}
	_ = claims

	return &integration{
		t: t, api: a, router: a.Routes(), db: db, userID: userID, events: sub.Channel(),
		cookie: &http.Cookie{Name: sessionCookieName, Value: token},
	}
}

func (c *integration) request(method, path string, body any) *httptest.ResponseRecorder {
	c.t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			c.t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, path, &buf)
	req.AddCookie(c.cookie)
	rec := httptest.NewRecorder()
	c.router.ServeHTTP(rec, req)
	return rec
}

func (c *integration) mustJSON(rec *httptest.ResponseRecorder, wantStatus int, into any) {
	c.t.Helper()
	if rec.Code != wantStatus {
		c.t.Fatalf("HTTP %d bekleniyordu, %d geldi: %s", wantStatus, rec.Code, rec.Body.String())
	}
	if into != nil {
		if err := json.Unmarshal(rec.Body.Bytes(), into); err != nil {
			c.t.Fatalf("yanıt çözülemedi: %v (%s)", err, rec.Body.String())
		}
	}
}

func (c *integration) newNode(name string) string {
	c.t.Helper()
	var id string
	if err := c.db.QueryRow(context.Background(),
		`INSERT INTO nodes (name, api_key_hash) VALUES ($1, 'x') RETURNING id`, name).Scan(&id); err != nil {
		c.t.Fatal(err)
	}
	c.t.Cleanup(func() { _, _ = c.db.Exec(context.Background(), `DELETE FROM nodes WHERE id = $1`, id) })
	return id
}

type rulePayload struct {
	Name      string  `json:"name"`
	NodeID    *string `json:"node_id"`
	Metric    string  `json:"metric"`
	Operator  string  `json:"operator"`
	Threshold float64 `json:"threshold"`
	Duration  int     `json:"duration_seconds"`
	Severity  string  `json:"severity"`
	Enabled   *bool   `json:"enabled,omitempty"`
}

func (c *integration) newRule(p rulePayload) AlertRule {
	c.t.Helper()
	var rule AlertRule
	c.mustJSON(c.request(http.MethodPost, "/api/v1/alert-rules", p), http.StatusCreated, &rule)
	c.t.Cleanup(func() { _, _ = c.db.Exec(context.Background(), `DELETE FROM alert_rules WHERE id = $1`, rule.ID) })
	return rule
}

func (c *integration) updateRule(rule AlertRule, mutate func(*rulePayload)) AlertRule {
	c.t.Helper()
	enabled := rule.Enabled
	p := rulePayload{Name: rule.Name, NodeID: rule.NodeID, Metric: rule.Metric, Operator: rule.Operator,
		Threshold: rule.Threshold, Duration: rule.DurationSeconds, Severity: rule.Severity, Enabled: &enabled}
	mutate(&p)
	var out AlertRule
	c.mustJSON(c.request(http.MethodPut, "/api/v1/alert-rules/"+strconv.FormatInt(rule.ID, 10), p), http.StatusOK, &out)
	return out
}

func (c *integration) sample(nodeID string, cpu float64) {
	c.sampleAt(nodeID, cpu, time.Now())
}

func (c *integration) sampleAt(nodeID string, cpu float64, at time.Time) {
	c.api.Engine.Evaluate(context.Background(), nodeID, []alerting.Sample{{Time: at, CPUPercent: cpu}})
}

// next: bir sonraki olayı bekler; pred'i sağlamayan olaylar (ör. önceki testlerden gecikmiş) atlanır.
func (c *integration) next(pred func(map[string]any) bool) map[string]any {
	c.t.Helper()
	timeout := time.After(5 * time.Second)
	for {
		select {
		case msg := <-c.events:
			var ev map[string]any
			if err := json.Unmarshal([]byte(msg.Payload), &ev); err != nil {
				c.t.Fatal(err)
			}
			if pred(ev) {
				return ev
			}
		case <-timeout:
			c.t.Fatal("beklenen olay 5 sn içinde gelmedi")
		}
	}
}

func (c *integration) noEvent(pred func(map[string]any) bool) {
	c.t.Helper()
	timeout := time.After(700 * time.Millisecond)
	for {
		select {
		case msg := <-c.events:
			var ev map[string]any
			_ = json.Unmarshal([]byte(msg.Payload), &ev)
			if pred(ev) {
				c.t.Fatalf("beklenmeyen olay: %s", msg.Payload)
			}
		case <-timeout:
			return
		}
	}
}

func forNode(nodeID, event string) func(map[string]any) bool {
	return func(ev map[string]any) bool { return ev["node_id"] == nodeID && ev["event"] == event }
}

func (c *integration) alertStatus(nodeID string, ruleID int64) []string {
	c.t.Helper()
	rows, err := c.db.Query(context.Background(),
		`SELECT status FROM alerts WHERE node_id = $1 AND rule_id = $2 ORDER BY id`, nodeID, ruleID)
	if err != nil {
		c.t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			c.t.Fatal(err)
		}
		out = append(out, s)
	}
	return out
}

func TestIntegration_AlertEventsCarryFullRowAndRESTHasRuleFields(t *testing.T) {
	c := newIntegration(t)
	nodeID := c.newNode("it-node-yasam-dongusu")
	rule := c.newRule(rulePayload{Name: "it-yuksek-cpu", Metric: "cpu_percent", Operator: ">", Threshold: 1, Severity: "critical"})

	// açılış
	c.sample(nodeID, 50)
	opened := c.next(forNode(nodeID, "opened"))
	if opened["node_name"] != "it-node-yasam-dongusu" || opened["operator"] != ">" || opened["severity"] != "critical" ||
		opened["metric"] != "cpu_percent" || opened["status"] != "open" {
		t.Errorf("opened olayı eksik/yanlış: %v", opened)
	}
	if opened["acknowledged_at"] != nil || opened["resolved_at"] != nil {
		t.Errorf("opened olayında zamanlar null olmalı: %v", opened)
	}
	if _, has := opened["acknowledged_by"]; has {
		t.Errorf("opened olayında acknowledged_by olmamalı: %v", opened)
	}

	// REST: S1 alanları
	var list []Alert
	c.mustJSON(c.request(http.MethodGet, "/api/v1/alerts?status=open", nil), http.StatusOK, &list)
	var found *Alert
	for i := range list {
		if list[i].NodeID == nodeID {
			found = &list[i]
		}
	}
	if found == nil {
		t.Fatal("açılan alarm GET /alerts'te yok")
	}
	if found.Severity != "critical" || found.Metric != "cpu_percent" || found.Operator != ">" || found.Threshold != 1 {
		t.Errorf("REST alarm satırında kural alanları eksik: %+v", *found)
	}

	// incelemeye alma
	var acked realtime.AlertEvent
	c.mustJSON(c.request(http.MethodPost, "/api/v1/alerts/"+strconv.FormatInt(found.ID, 10)+"/ack", nil), http.StatusOK, &acked)
	ev := c.next(forNode(nodeID, "acknowledged"))
	if ev["node_name"] != "it-node-yasam-dongusu" || ev["operator"] != ">" || ev["acknowledged_by"] != "Test Kullanici" ||
		ev["acknowledged_at"] == nil || ev["resolved_at"] != nil {
		t.Errorf("acknowledged olayı eksik/yanlış: %v", ev)
	}
	if acked.NodeName != "it-node-yasam-dongusu" || acked.AcknowledgedAt == nil {
		t.Errorf("ack yanıtı da zengin olmalı: %+v", acked)
	}

	// çözülme: ack bilgisi korunur
	c.sample(nodeID, 0.5)
	resolved := c.next(forNode(nodeID, "resolved"))
	if resolved["status"] != "resolved" || resolved["resolved_at"] == nil || resolved["acknowledged_at"] == nil ||
		resolved["acknowledged_by"] != "Test Kullanici" || resolved["node_name"] != "it-node-yasam-dongusu" {
		t.Errorf("resolved olayı eksik/yanlış: %v", resolved)
	}
	_ = rule
}

func TestIntegration_DisablingRuleResolvesActiveAlertsAndReenablingWorks(t *testing.T) {
	c := newIntegration(t)
	nodeID := c.newNode("it-node-devre-disi")
	rule := c.newRule(rulePayload{Name: "it-kural-kapat", Metric: "cpu_percent", Operator: ">", Threshold: 1, Severity: "warning"})

	c.sample(nodeID, 50)
	c.next(forNode(nodeID, "opened"))

	rule = c.updateRule(rule, func(p *rulePayload) { off := false; p.Enabled = &off })

	ev := c.next(forNode(nodeID, "resolved"))
	if ev["rule_id"] != float64(rule.ID) || ev["node_name"] != "it-node-devre-disi" || ev["resolved_at"] == nil {
		t.Errorf("devre dışı bırakma resolved olayı yanlış: %v", ev)
	}
	if got := c.alertStatus(nodeID, rule.ID); len(got) != 1 || got[0] != "resolved" {
		t.Errorf("DB'de alarm resolved olmalı: %v", got)
	}

	// Kapalı kural yeni alarm açmaz.
	c.sample(nodeID, 60)
	c.noEvent(forNode(nodeID, "opened"))

	// İkinci kez devre dışı bırakmak yeni olay üretmez (idempotent).
	c.updateRule(rule, func(p *rulePayload) { off := false; p.Enabled = &off })
	c.noEvent(forNode(nodeID, "resolved"))

	// Yeniden etkinleştirince (motorun bellek durumu temizlendiği için) yeni alarm açılır.
	c.updateRule(rule, func(p *rulePayload) { on := true; p.Enabled = &on })
	c.sample(nodeID, 70)
	c.next(forNode(nodeID, "opened"))
	if got := c.alertStatus(nodeID, rule.ID); len(got) != 2 || got[0] != "resolved" || got[1] != "open" {
		t.Errorf("yeniden etkinleştirmeden sonra yeni açık alarm bekleniyordu: %v", got)
	}
}

func TestIntegration_NarrowingRuleScopeResolvesOutOfScopeAlertsOnly(t *testing.T) {
	c := newIntegration(t)
	nodeA := c.newNode("it-node-kapsam-a")
	nodeB := c.newNode("it-node-kapsam-b")
	rule := c.newRule(rulePayload{Name: "it-kural-kapsam", Metric: "cpu_percent", Operator: ">", Threshold: 1, Severity: "info"})

	c.sample(nodeA, 50)
	c.next(forNode(nodeA, "opened"))
	c.sample(nodeB, 50)
	c.next(forNode(nodeB, "opened"))

	c.updateRule(rule, func(p *rulePayload) { p.NodeID = &nodeA }) // yalnızca A

	c.next(forNode(nodeB, "resolved"))
	c.noEvent(forNode(nodeA, "resolved"))
	if got := c.alertStatus(nodeA, rule.ID); len(got) != 1 || got[0] != "open" {
		t.Errorf("A'nın alarmı açık kalmalı: %v", got)
	}
	if got := c.alertStatus(nodeB, rule.ID); len(got) != 1 || got[0] != "resolved" {
		t.Errorf("B'nin alarmı çözülmeli: %v", got)
	}
}

func TestIntegration_DeletingRuleResolvesThenAnnouncesDeletion(t *testing.T) {
	c := newIntegration(t)
	nodeID := c.newNode("it-node-silme")
	rule := c.newRule(rulePayload{Name: "it-kural-sil", Metric: "cpu_percent", Operator: ">", Threshold: 1, Severity: "critical"})

	c.sample(nodeID, 50)
	c.next(forNode(nodeID, "opened"))

	c.mustJSON(c.request(http.MethodDelete, "/api/v1/alert-rules/"+strconv.FormatInt(rule.ID, 10), nil), http.StatusNoContent, nil)

	c.next(forNode(nodeID, "resolved"))
	deleted := c.next(func(ev map[string]any) bool { return ev["type"] == "rule" && ev["rule_id"] == float64(rule.ID) })
	if deleted["event"] != "deleted" {
		t.Errorf("kural silme olayı yanlış: %v", deleted)
	}
	if got := c.alertStatus(nodeID, rule.ID); len(got) != 0 {
		t.Errorf("alarm satırları cascade ile silinmeliydi: %v", got)
	}

	// Olmayan kural: 404 ve olay yok.
	c.mustJSON(c.request(http.MethodDelete, "/api/v1/alert-rules/"+strconv.FormatInt(rule.ID, 10), nil), http.StatusNotFound, nil)
	c.noEvent(func(ev map[string]any) bool { return ev["type"] == "rule" })
}

// Süreli kuralda (duration_seconds > 0) eşik aşımı BAŞLANGICI bellekte tutulur. Kural bir sunucuya
// daraltılınca diğer sunucuların başlangıç kaydı silinmeli; kapsam sonradan genişleyince eski
// başlangıç zamanı süreye sayılıp alarm haksız yere hemen açılmamalı.
func TestIntegration_NarrowingScopeForgetsBreachStartOfOtherNodes(t *testing.T) {
	c := newIntegration(t)
	nodeA := c.newNode("it-node-sure-a")
	nodeB := c.newNode("it-node-sure-b")
	rule := c.newRule(rulePayload{Name: "it-kural-sure", Metric: "cpu_percent", Operator: ">", Threshold: 1, Duration: 300, Severity: "warning"})

	t0 := time.Now()
	c.sampleAt(nodeB, 50, t0) // B'de eşik aşımı BAŞLADI (süre dolmadı, alarm yok)

	rule = c.updateRule(rule, func(p *rulePayload) { p.NodeID = &nodeA }) // yalnızca A: B unutulmalı
	rule = c.updateRule(rule, func(p *rulePayload) { p.NodeID = nil })    // yeniden tüm sunucular

	// B'nin eski başlangıcı (t0) hâlâ sayılsaydı, t0+301sn'de alarm hemen açılırdı.
	c.sampleAt(nodeB, 50, t0.Add(301*time.Second))
	c.noEvent(forNode(nodeB, "opened"))

	// Yeni başlangıçtan 300 sn sonra ise gerçekten açılır.
	c.sampleAt(nodeB, 50, t0.Add(301*time.Second+300*time.Second))
	c.next(forNode(nodeB, "opened"))
	_ = rule
}
