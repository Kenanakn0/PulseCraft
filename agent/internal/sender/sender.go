package sender

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/Kenanakn0/pulsecraft/agent/internal/collector"
)

// Sender: metrikleri Core Server'a HTTP üzerinden gönderir.
type Sender struct {
	serverURL string
	apiKey    string
	hostname  string // boşsa gövdede hiç yer almaz (varsayılan)
	client    *http.Client
}

// New: bir Sender oluşturur. http.Client, C#'taki HttpClient gibi tek bir
// örnek olarak yaratılıp tekrar tekrar kullanılmalıdır — bağlantı havuzunu
// (connection pool) paylaşır, her istekte yeni Client oluşturmak israf olur.
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

// payload: sunucunun /api/v1/metrics endpoint'inde beklediği JSON gövdesi.
type payload struct {
	// omitempty: hostname ayarlanmadıysa alan JSON'da HİÇ bulunmaz (gerçek bilgisayar
	// adı asla kendiliğinden gönderilmez).
	Hostname string             `json:"hostname,omitempty"`
	Samples  []collector.Sample `json:"samples"`
}

// Send: samples listesini tek bir POST isteğiyle sunucuya gönderir.
// Sunucuya ulaşılamazsa veya 2xx dışında bir durum kodu dönerse hata döner.
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

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("sunucu beklenmeyen durum kodu döndürdü: %d", resp.StatusCode)
	}

	return nil
}

// BufferedSender: Sender'ı sarmalar (composition — Go'da kalıtım yoktur,
// "has-a" ilişkisi bir struct'ı başka bir struct'ın alanı yaparak kurulur).
// Gönderilemeyen örnekleri bellekte sınırlı bir buffer'da tutar ve
// exponential backoff ile tekrar dener.
type BufferedSender struct {
	sender     *Sender
	maxBuffer  int
	buffer     []collector.Sample
	backoff    time.Duration
	minBackoff time.Duration
	maxBackoff time.Duration
	nextTry    time.Time
}

// NewBuffered: en fazla maxBuffer örnek tutabilen bir BufferedSender oluşturur.
func NewBuffered(s *Sender, maxBuffer int) *BufferedSender {
	return &BufferedSender{
		sender:     s,
		maxBuffer:  maxBuffer,
		minBackoff: 1 * time.Second,
		maxBackoff: 60 * time.Second,
	}
}

// Add: yeni bir örneği buffer'a ekler. Buffer maxBuffer'ı aşarsa en eski
// örnekler atılır (sabit boyutlu bir kuyruk).
func (b *BufferedSender) Add(sample collector.Sample) {
	b.buffer = append(b.buffer, sample)
	if len(b.buffer) > b.maxBuffer {
		dropped := len(b.buffer) - b.maxBuffer
		b.buffer = b.buffer[dropped:]
		slog.Warn("buffer dolu, en eski örnekler atıldı", "dropped", dropped, "buffer_size", b.maxBuffer)
	}
}

// Flush: buffer boş değilse ve backoff süresi dolmuşsa, buffer'daki TÜM
// örnekleri TEK bir istekte göndermeyi dener (toplu gönderim). Başarılı
// olursa buffer temizlenir ve backoff sıfırlanır; başarısız olursa backoff
// katlanarak (exponential) artar — sunucu ayaktayken her tick'te değil,
// gittikçe seyrekleşen aralıklarla tekrar denenir.
func (b *BufferedSender) Flush(ctx context.Context) {
	if len(b.buffer) == 0 {
		return
	}
	if time.Now().Before(b.nextTry) {
		slog.Info("backoff bekleniyor, gönderim atlandı",
			"buffered", len(b.buffer), "retry_in", time.Until(b.nextTry).Round(time.Second))
		return
	}

	sendCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if err := b.sender.Send(sendCtx, b.buffer); err != nil {
		b.backoff = nextBackoff(b.backoff, b.minBackoff, b.maxBackoff)
		b.nextTry = time.Now().Add(b.backoff)
		slog.Warn("gönderim başarısız, tekrar denenecek",
			"err", err, "buffered", len(b.buffer), "backoff", b.backoff)
		return
	}

	slog.Info("sunucuya gönderildi (toplu)", "count", len(b.buffer))
	b.buffer = b.buffer[:0]
	b.backoff = 0
}

// nextBackoff: mevcut backoff'u ikiye katlar (0 ise min'den başlar),
// max'ı aşmasına izin vermez. C#'ta Polly kütüphanesindeki exponential
// backoff politikasıyla aynı fikir.
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
