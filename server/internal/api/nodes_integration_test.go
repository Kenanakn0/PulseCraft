package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Like alerts_integration_test.go, these need a real database and Redis (see newIntegration).

func (c *integration) createNodeViaAPI(name string) (id, apiKey string) {
	c.t.Helper()
	var resp createNodeResponse
	c.mustJSON(c.request(http.MethodPost, "/api/v1/nodes", map[string]string{"name": name}), http.StatusCreated, &resp)
	c.t.Cleanup(func() { _, _ = c.db.Exec(context.Background(), `DELETE FROM nodes WHERE id = $1`, resp.ID) })
	return resp.ID, resp.APIKey
}

// ingest sends one sample like the agent does: no session cookie, only the Bearer key.
func (c *integration) ingest(apiKey string, cpu float64) int {
	c.t.Helper()
	body, _ := json.Marshal(map[string]any{"samples": []map[string]any{{
		"time": time.Now().UTC().Format(time.RFC3339Nano), "cpu_percent": cpu, "mem_percent": 1,
		"mem_used_bytes": 1, "disk_percent": 1, "net_rx_bps": 1, "net_tx_bps": 1,
	}}})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/metrics", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+apiKey)
	rec := httptest.NewRecorder()
	c.router.ServeHTTP(rec, req)
	return rec.Code
}

func (c *integration) count(sql string, args ...any) int {
	c.t.Helper()
	var n int
	if err := c.db.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		c.t.Fatal(err)
	}
	return n
}

func TestIntegration_DeleteNode_ResolvesAlertsCascadesAndAnnounces(t *testing.T) {
	c := newIntegration(t)
	nodeA, keyA := c.createNodeViaAPI("it-node-silinecek")
	nodeB := c.newNode("it-node-kalacak")

	global := c.newRule(rulePayload{Name: "it-genel-kural", Metric: "cpu_percent", Operator: ">", Threshold: 1, Severity: "warning"})
	scoped := c.newRule(rulePayload{Name: "it-a-kurali", NodeID: &nodeA, Metric: "cpu_percent", Operator: ">", Threshold: 1, Severity: "critical"})

	if code := c.ingest(keyA, 50); code != http.StatusAccepted {
		t.Fatalf("A için ölçüm 202 bekleniyordu, %d", code)
	}
	c.next(func(ev map[string]any) bool {
		return ev["node_id"] == nodeA && ev["event"] == "opened" && ev["rule_id"] == float64(global.ID)
	})
	c.next(func(ev map[string]any) bool {
		return ev["node_id"] == nodeA && ev["event"] == "opened" && ev["rule_id"] == float64(scoped.ID)
	})
	c.sample(nodeB, 50)
	c.next(forNode(nodeB, "opened"))

	c.mustJSON(c.request(http.MethodDelete, "/api/v1/nodes/"+nodeA, nil), http.StatusNoContent, nil)

	// Event order: A's two active alerts resolved → A's own rule deleted → node deleted.
	resolved := map[float64]bool{}
	for len(resolved) < 2 {
		ev := c.next(forNode(nodeA, "resolved"))
		if ev["node_name"] != "it-node-silinecek" || ev["resolved_at"] == nil {
			t.Errorf("resolved olayı eksik: %v", ev)
		}
		resolved[ev["rule_id"].(float64)] = true
	}
	if !resolved[float64(global.ID)] || !resolved[float64(scoped.ID)] {
		t.Errorf("A'nın her iki alarmı çözülmeliydi: %v", resolved)
	}
	c.next(func(ev map[string]any) bool { return ev["type"] == "rule" && ev["rule_id"] == float64(scoped.ID) })
	nodeEv := c.next(func(ev map[string]any) bool { return ev["type"] == "node" })
	if nodeEv["event"] != "deleted" || nodeEv["node_id"] != nodeA {
		t.Errorf("node deleted olayı yanlış: %v", nodeEv)
	}
	// B's alert is untouched; no "rule deleted" for the global rule.
	c.noEvent(func(ev map[string]any) bool {
		return ev["node_id"] == nodeB || (ev["type"] == "rule" && ev["rule_id"] == float64(global.ID))
	})

	// Cascade: A's metrics, alerts and own rule are gone; the global rule and B's alert remain.
	if n := c.count(`SELECT count(*) FROM nodes WHERE id = $1`, nodeA); n != 0 {
		t.Errorf("node silinmedi")
	}
	if n := c.count(`SELECT count(*) FROM metrics WHERE node_id = $1`, nodeA); n != 0 {
		t.Errorf("A'nın metrikleri cascade ile silinmeliydi: %d", n)
	}
	if n := c.count(`SELECT count(*) FROM alerts WHERE node_id = $1`, nodeA); n != 0 {
		t.Errorf("A'nın alarm satırları (geçmiş dahil) silinmeliydi: %d", n)
	}
	if n := c.count(`SELECT count(*) FROM alert_rules WHERE id = $1`, scoped.ID); n != 0 {
		t.Errorf("A'ya özel kural silinmeliydi")
	}
	if n := c.count(`SELECT count(*) FROM alert_rules WHERE id = $1`, global.ID); n != 1 {
		t.Errorf("genel kural kalmalıydı")
	}
	if got := c.alertStatus(nodeB, global.ID); len(got) != 1 || got[0] != "open" {
		t.Errorf("B'nin alarmı açık kalmalıydı: %v", got)
	}

	if code := c.ingest(keyA, 50); code != http.StatusUnauthorized {
		t.Errorf("silinen sunucunun anahtarıyla ölçüm 401 olmalı, %d", code)
	}

	c.mustJSON(c.request(http.MethodDelete, "/api/v1/nodes/"+nodeA, nil), http.StatusNotFound, nil)
	c.noEvent(func(ev map[string]any) bool { return ev["type"] == "node" })
	c.mustJSON(c.request(http.MethodDelete, "/api/v1/nodes/gecersiz-kimlik", nil), http.StatusBadRequest, nil)
}

// A breach that has not opened an alert yet is kept in memory. Behaviourally: after deleting a node,
// another node's timed breach still opens normally (the engine is not broken).
func TestIntegration_DeleteNode_EngineKeepsWorkingForOtherNodes(t *testing.T) {
	c := newIntegration(t)
	nodeA, _ := c.createNodeViaAPI("it-node-sureli-silinecek")
	nodeB := c.newNode("it-node-sureli-kalacak")
	c.newRule(rulePayload{Name: "it-sureli-genel", Metric: "cpu_percent", Operator: ">", Threshold: 1, Duration: 60, Severity: "info"})

	t0 := time.Now()
	c.sampleAt(nodeA, 50, t0)
	c.sampleAt(nodeB, 50, t0)
	c.mustJSON(c.request(http.MethodDelete, "/api/v1/nodes/"+nodeA, nil), http.StatusNoContent, nil)

	c.sampleAt(nodeB, 50, t0.Add(61*time.Second))
	c.next(forNode(nodeB, "opened"))
}

func TestIntegration_CreateNode_NameIsTrimmedAndValidated(t *testing.T) {
	c := newIntegration(t)

	id, key := c.createNodeViaAPI("   it-kirpilan-ad   ")
	if key == "" || len(key) != 64 {
		t.Errorf("64 haneli hex anahtar bekleniyordu: %q", key)
	}
	var name string
	if err := c.db.QueryRow(context.Background(), `SELECT name FROM nodes WHERE id = $1`, id).Scan(&name); err != nil {
		t.Fatal(err)
	}
	if name != "it-kirpilan-ad" {
		t.Errorf("ad kırpılmalıydı: %q", name)
	}

	for _, bad := range []string{"", "   ", strings.Repeat("ş", 101)} {
		rec := c.request(http.MethodPost, "/api/v1/nodes", map[string]string{"name": bad})
		if rec.Code != http.StatusBadRequest {
			t.Errorf("ad %q için 400 bekleniyordu, %d", bad, rec.Code)
		}
	}
	// Exactly 100 characters (multi-byte) is accepted.
	c.createNodeViaAPI(strings.Repeat("ş", 100))
}
