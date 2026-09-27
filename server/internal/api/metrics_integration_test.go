package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// Gerçek DB ister (bkz. newIntegration); şema: deploy/init/01_schema.sql (ux_metrics_node_time dahil).

// ingestBatch: agent gibi (yalnızca Bearer anahtarla) verilen örnekleri tek istekte gönderir.
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

	// Agent zaman aşımına uğrayıp AYNI batch'i yeniden gönderdi (sunucu ilkini aslında yazmıştı).
	for i := 0; i < 2; i++ {
		if code := c.ingestBatch(key, batch); code != http.StatusAccepted {
			t.Fatalf("%d. gönderim 202 bekleniyordu, %d", i+1, code)
		}
	}
	if n := c.count(`SELECT count(*) FROM metrics WHERE node_id = $1`, nodeID); n != 3 {
		t.Errorf("yeniden gönderim mükerrer satır üretmemeli: %d satır (3 bekleniyordu)", n)
	}

	// Kısmen örtüşen batch: yeniler eklenir, eskiler atlanır.
	overlap := []map[string]any{sampleAt(base.Add(2*time.Second), 99, nil), sampleAt(base.Add(3*time.Second), 40, nil)}
	if code := c.ingestBatch(key, overlap); code != http.StatusAccepted {
		t.Fatalf("örtüşen batch 202 bekleniyordu, %d", code)
	}
	if n := c.count(`SELECT count(*) FROM metrics WHERE node_id = $1`, nodeID); n != 4 {
		t.Errorf("yalnızca yeni örnek eklenmeliydi: %d satır (4 bekleniyordu)", n)
	}
	// İlk yazılan kazanır: çakışan örneğin değeri değişmedi (DO NOTHING, DO UPDATE değil).
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

	// Agent'ın tampon üst sınırı kadar (1000) örnek, tek istekte; yarısında load1 var (Linux), yarısında yok (Windows).
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
