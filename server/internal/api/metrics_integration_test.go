package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func (c *integration) ingestBatch(apiKey string, samples []map[string]any) int {
	c.t.Helper()
	body, _ := json.Marshal(map[string]any{"samples": samples})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/metrics", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+apiKey)
	rec := httptest.NewRecorder()
	c.router.ServeHTTP(rec, req)
	return rec.Code
}

func sampleAt(t time.Time, cpu float64, load1 *float64) map[string]any {
	m := map[string]any{
		"time": t.UTC().Format(time.RFC3339Nano), "cpu_percent": cpu, "mem_percent": 50,
		"mem_used_bytes": uint64(8) << 30, "disk_percent": 60, "net_rx_bps": 1000, "net_tx_bps": 500,
	}
	if load1 != nil {
		m["load1"] = *load1
	}
	return m
}

func TestIntegration_Metrics_ResentBatchDoesNotDuplicateRows(t *testing.T) {
	c := newIntegration(t)
	nodeID, key := c.createNodeViaAPI("it-node-mukerrer")

	base := time.Now().Add(-time.Minute).Truncate(time.Millisecond)
	batch := []map[string]any{sampleAt(base, 10, nil), sampleAt(base.Add(time.Second), 20, nil), sampleAt(base.Add(2*time.Second), 30, nil)}

	// The agent timed out and re-sent the same batch although the server had stored it.
	for i := 0; i < 2; i++ {
		if code := c.ingestBatch(key, batch); code != http.StatusAccepted {
			t.Fatalf("%d. gönderim 202 bekleniyordu, %d", i+1, code)
		}
	}
	if n := c.count(`SELECT count(*) FROM metrics WHERE node_id = $1`, nodeID); n != 3 {
		t.Errorf("yeniden gönderim mükerrer satır üretmemeli: %d satır (3 bekleniyordu)", n)
	}

	overlap := []map[string]any{sampleAt(base.Add(2*time.Second), 99, nil), sampleAt(base.Add(3*time.Second), 40, nil)}
	if code := c.ingestBatch(key, overlap); code != http.StatusAccepted {
		t.Fatalf("örtüşen batch 202 bekleniyordu, %d", code)
	}
	if n := c.count(`SELECT count(*) FROM metrics WHERE node_id = $1`, nodeID); n != 4 {
		t.Errorf("yalnızca yeni örnek eklenmeliydi: %d satır (4 bekleniyordu)", n)
	}
	// The first write wins (DO NOTHING, not DO UPDATE).
	var cpu float64
	if err := c.db.QueryRow(t.Context(), `SELECT cpu_percent FROM metrics WHERE node_id = $1 AND time = $2`,
		nodeID, base.Add(2*time.Second)).Scan(&cpu); err != nil {
		t.Fatal(err)
	}
	if cpu != 30 {
		t.Errorf("çakışan örnek ezilmemeliydi: cpu=%v (30 bekleniyordu)", cpu)
	}
}

func TestIntegration_Metrics_DuplicateWithinOneBatchIsSkipped(t *testing.T) {
	c := newIntegration(t)
	nodeID, key := c.createNodeViaAPI("it-node-ic-mukerrer")

	ts := time.Now().Add(-time.Minute).Truncate(time.Millisecond)
	batch := []map[string]any{sampleAt(ts, 10, nil), sampleAt(ts, 11, nil), sampleAt(ts.Add(time.Second), 12, nil)}
	if code := c.ingestBatch(key, batch); code != http.StatusAccepted {
		t.Fatalf("202 bekleniyordu, %d", code)
	}
	if n := c.count(`SELECT count(*) FROM metrics WHERE node_id = $1`, nodeID); n != 2 {
		t.Errorf("aynı istek içindeki mükerrer atlanmalıydı: %d satır (2 bekleniyordu)", n)
	}
}

func TestIntegration_Metrics_LargeBatchAndNullableLoad1(t *testing.T) {
	c := newIntegration(t)
	nodeID, key := c.createNodeViaAPI("it-node-buyuk-batch")

	// The agent's buffer limit (1000) in one request; half with load1 (Linux), half without (Windows).
	start := time.Now().Add(-time.Hour).Truncate(time.Second)
	batch := make([]map[string]any, 1000)
	for i := range batch {
		var load *float64
		if i%2 == 0 {
			v := float64(i) / 100
			load = &v
		}
		batch[i] = sampleAt(start.Add(time.Duration(i)*time.Second), float64(i%100), load)
	}

	began := time.Now()
	if code := c.ingestBatch(key, batch); code != http.StatusAccepted {
		t.Fatalf("202 bekleniyordu, %d", code)
	}
	t.Logf("1000 örnek tek sorguda yazıldı: %v", time.Since(began))

	if n := c.count(`SELECT count(*) FROM metrics WHERE node_id = $1`, nodeID); n != 1000 {
		t.Errorf("1000 satır bekleniyordu: %d", n)
	}
	if n := c.count(`SELECT count(*) FROM metrics WHERE node_id = $1 AND load1 IS NULL`, nodeID); n != 500 {
		t.Errorf("load1 NULL olarak korunmalıydı: %d NULL (500 bekleniyordu)", n)
	}
	var memUsed int64
	if err := c.db.QueryRow(t.Context(), `SELECT mem_used_bytes FROM metrics WHERE node_id = $1 LIMIT 1`, nodeID).Scan(&memUsed); err != nil {
		t.Fatal(err)
	}
	if memUsed != 8<<30 {
		t.Errorf("mem_used_bytes bozuldu: %d", memUsed)
	}
}

func TestIntegration_Metrics_RejectsOversizedRequests(t *testing.T) {
	c := newIntegration(t)
	nodeID, key := c.createNodeViaAPI("it-node-boyut-siniri")

	start := time.Now().Add(-2 * time.Hour).Truncate(time.Second)
	batch := func(n int) []map[string]any {
		b := make([]map[string]any, n)
		for i := range b {
			b[i] = sampleAt(start.Add(time.Duration(i)*time.Second), 10, nil)
		}
		return b
	}

	if code := c.ingestBatch(key, batch(maxSamplesPerRequest+1)); code != http.StatusRequestEntityTooLarge {
		t.Fatalf("%d örnek: kod %d, beklenen 413", maxSamplesPerRequest+1, code)
	}
	if n := c.count(`SELECT count(*) FROM metrics WHERE node_id = $1`, nodeID); n != 0 {
		t.Fatalf("reddedilen istekten %d satır yazıldı", n)
	}

	// The body limit (2 MiB) applies regardless of the sample count.
	body, _ := json.Marshal(map[string]any{"hostname": strings.Repeat("h", maxRequestBody), "samples": batch(1)})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/metrics", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+key)
	rec := httptest.NewRecorder()
	c.router.ServeHTTP(rec, req)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("2 MiB'ı aşan gövde: kod %d, beklenen 413", rec.Code)
	}
	if n := c.count(`SELECT count(*) FROM metrics WHERE node_id = $1`, nodeID); n != 0 {
		t.Fatalf("reddedilen istekten %d satır yazıldı", n)
	}

	if code := c.ingestBatch(key, batch(maxSamplesPerRequest)); code != http.StatusAccepted {
		t.Fatalf("tam %d örnek: kod %d, beklenen 202", maxSamplesPerRequest, code)
	}
}
