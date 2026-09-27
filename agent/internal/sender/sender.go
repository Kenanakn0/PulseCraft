package sender

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/Kenanakn0/pulsecraft/agent/internal/collector"
)

type Sender struct {
	serverURL string
	apiKey    string
	hostname  string
	client    *http.Client
}

// New creates a Sender. Reuse it: it shares one http.Client and its connection pool.
func New(serverURL, apiKey, hostname string) *Sender {
	return &Sender{
		serverURL: serverURL,
		apiKey:    apiKey,
		hostname:  hostname,
		client: &http.Client{
			Timeout: 5 * time.Second,
		},
	}
}

type payload struct {
	// omitempty: without -hostname the field is absent, never an automatically detected name.
	Hostname string             `json:"hostname,omitempty"`
	Samples  []collector.Sample `json:"samples"`
}

// ErrUnauthorized: the server rejected the key (wrong key or deleted server). Retrying cannot help, so the
// caller should stop with a clear message.
var ErrUnauthorized = errors.New("sunucu API anahtarını reddetti (HTTP 401)")

func (s *Sender) Send(ctx context.Context, samples []collector.Sample) error {
	body, err := json.Marshal(payload{Hostname: s.hostname, Samples: samples})
	if err != nil {
		return fmt.Errorf("gövde json'a çevrilemedi: %w", err)
	}

	url := s.serverURL + "/api/v1/metrics"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("istek oluşturulamadı: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.apiKey)

	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("istek gönderilemedi: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return ErrUnauthorized
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("sunucu beklenmeyen durum kodu döndürdü: %d (%s)", resp.StatusCode, url)
	}

	return nil
}

// BufferedSender keeps unsent samples in a bounded buffer and retries with exponential backoff.
type BufferedSender struct {
	sender     *Sender
	maxBuffer  int
	buffer     []collector.Sample
	backoff    time.Duration
	minBackoff time.Duration
	maxBackoff time.Duration
	nextTry    time.Time
}

func NewBuffered(s *Sender, maxBuffer int) *BufferedSender {
	return &BufferedSender{
		sender:     s,
		maxBuffer:  maxBuffer,
		minBackoff: 1 * time.Second,
		maxBackoff: 60 * time.Second,
	}
}

// Add drops the oldest samples when the buffer is full.
func (b *BufferedSender) Add(sample collector.Sample) {
	b.buffer = append(b.buffer, sample)
	if len(b.buffer) > b.maxBuffer {
		dropped := len(b.buffer) - b.maxBuffer
		b.buffer = b.buffer[dropped:]
		slog.Warn("buffer dolu, en eski örnekler atıldı", "dropped", dropped, "buffer_size", b.maxBuffer)
	}
}

// Flush sends the whole buffer in one request once the backoff has elapsed. On failure the backoff
// doubles, so an unreachable server is retried less and less often.
//
// Only a permanent error is returned (ErrUnauthorized); transient errors are logged and retried later.
func (b *BufferedSender) Flush(ctx context.Context) error {
	if len(b.buffer) == 0 {
		return nil
	}
	if time.Now().Before(b.nextTry) {
		slog.Info("backoff bekleniyor, gönderim atlandı",
			"buffered", len(b.buffer), "retry_in", time.Until(b.nextTry).Round(time.Second))
		return nil
	}

	sendCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if err := b.sender.Send(sendCtx, b.buffer); err != nil {
		if errors.Is(err, ErrUnauthorized) {
			return err
		}
		b.backoff = nextBackoff(b.backoff, b.minBackoff, b.maxBackoff)
		b.nextTry = time.Now().Add(b.backoff)
		slog.Warn("gönderim başarısız, tekrar denenecek",
			"err", err, "buffered", len(b.buffer), "backoff", b.backoff)
		return nil
	}

	slog.Info("sunucuya gönderildi (toplu)", "count", len(b.buffer))
	b.buffer = b.buffer[:0]
	b.backoff = 0
	return nil
}

func nextBackoff(current, min, max time.Duration) time.Duration {
	if current == 0 {
		return min
	}
	next := current * 2
	if next > max {
		return max
	}
	return next
}
