package sender

import (
	"context"
	"encoding/json"
	"errors"
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

// statusServer: her isteğe verilen durum koduyla yanıt veren test sunucusu.
func statusServer(t *testing.T, code int) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(code) }))
	t.Cleanup(srv.Close)
	return srv
}

func TestSend_401IsErrUnauthorized(t *testing.T) {
	err := New(statusServer(t, http.StatusUnauthorized).URL, "anahtar", "").Send(context.Background(), sampleBatch())
	if !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("ErrUnauthorized bekleniyordu: %v", err)
	}
	err = New(statusServer(t, http.StatusInternalServerError).URL, "anahtar", "").Send(context.Background(), sampleBatch())
	if err == nil || errors.Is(err, ErrUnauthorized) {
		t.Fatalf("500 geçici hata olmalı, ErrUnauthorized değil: %v", err)
	}
}

func TestFlush_ReturnsOnlyPermanentUnauthorized(t *testing.T) {
	// 401: kalıcı → döndürülür (agent durur), örnekler buffer'da kalır.
	b := NewBuffered(New(statusServer(t, http.StatusUnauthorized).URL, "anahtar", ""), 10)
	b.Add(sampleBatch()[0])
	if err := b.Flush(context.Background()); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("401'de ErrUnauthorized dönmeli: %v", err)
	}

	// 503: geçici → nil döner (backoff ile yeniden denenecek), agent çalışmaya devam eder.
	b = NewBuffered(New(statusServer(t, http.StatusServiceUnavailable).URL, "anahtar", ""), 10)
	b.Add(sampleBatch()[0])
	if err := b.Flush(context.Background()); err != nil {
		t.Fatalf("geçici hatada nil dönmeli: %v", err)
	}
	if b.backoff == 0 {
		t.Errorf("geçici hatada backoff artmalıydı")
	}

	// 202: başarı → nil, buffer boşalır.
	b = NewBuffered(New(statusServer(t, http.StatusAccepted).URL, "anahtar", ""), 10)
	b.Add(sampleBatch()[0])
	if err := b.Flush(context.Background()); err != nil || len(b.buffer) != 0 {
		t.Fatalf("başarıda buffer boşalmalı: err=%v len=%d", err, len(b.buffer))
	}
}
