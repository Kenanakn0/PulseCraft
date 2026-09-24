package sender

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Kenanakn0/pulsecraft/agent/internal/collector"
)

// capture: gelen isteğin başlığını ve JSON gövdesini yakalayan test sunucusu.
func capture(t *testing.T) (*httptest.Server, *map[string]any, *http.Header) {
	t.Helper()
	var body map[string]any
	var header http.Header
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header = r.Header.Clone()
		raw, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(raw, &body); err != nil {
			t.Errorf("gövde JSON değil: %v", err)
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	t.Cleanup(srv.Close)
	return srv, &body, &header
}

func sampleBatch() []collector.Sample {
	return []collector.Sample{{Time: time.Now(), CPUPercent: 1}}
}

func TestSend_HostnameIsOmittedByDefault(t *testing.T) {
	srv, body, header := capture(t)

	if err := New(srv.URL, "anahtar", "").Send(context.Background(), sampleBatch()); err != nil {
		t.Fatal(err)
	}

	if _, present := (*body)["hostname"]; present {
		t.Errorf("hostname ayarlanmadıysa gövdede HİÇ olmamalı: %v", *body)
	}
	if samples, _ := (*body)["samples"].([]any); len(samples) != 1 {
		t.Errorf("samples eksik: %v", *body)
	}
	if got := header.Get("Authorization"); got != "Bearer anahtar" {
		t.Errorf("Authorization = %q", got)
	}
}

func TestSend_HostnameIsSentWhenConfigured(t *testing.T) {
	srv, body, _ := capture(t)

	if err := New(srv.URL, "anahtar", "demo-sunucu-1").Send(context.Background(), sampleBatch()); err != nil {
		t.Fatal(err)
	}

	if got := (*body)["hostname"]; got != "demo-sunucu-1" {
		t.Errorf("hostname = %v, beklenen demo-sunucu-1", got)
	}
}
