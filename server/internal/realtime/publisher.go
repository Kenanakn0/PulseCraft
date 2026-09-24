package realtime

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
)

// publishTimeout: tek bir yayının Redis'te en fazla bekleyeceği süre.
const publishTimeout = 2 * time.Second

// queueSize: bekleyen yayın işi sınırı. Redis yavaşlarsa/kesilirse kuyruk
// dolar ve yeni olaylar atılır; bellek sınırsız büyümez.
const queueSize = 1024

type job struct {
	channel  string
	payloads [][]byte
}

// Publisher: olayları Redis kanallarına yayınlar. Yayın istek yolunda
// BEKLENMEZ: PublishX çağrıları işi kuyruğa atıp döner, tek bir worker
// goroutine (Run) sırayla Redis'e yazar. Böylece Redis kesildiğinde HTTP
// istekleri yavaşlamaz — aksi halde agent zaman aşımına uğrayıp aynı batch'i
// yeniden gönderir ve metrics tablosunda mükerrer satır oluşurdu.
// Canlı yayın "en iyi çaba"dır: kesintide olaylar kaybolur, asıl veri (DB) etkilenmez.
type Publisher struct {
	rdb     *redis.Client
	queue   chan job
	dropped atomic.Int64
}

func NewPublisher(rdb *redis.Client) *Publisher {
	return &Publisher{rdb: rdb, queue: make(chan job, queueSize)}
}

// Run: ctx iptal edilene kadar kuyruğu boşaltıp Redis'e yazar.
func (p *Publisher) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case j := <-p.queue:
			p.send(ctx, j)
		}
	}
}

func (p *Publisher) send(ctx context.Context, j job) {
	ctx, cancel := context.WithTimeout(ctx, publishTimeout)
	defer cancel()

	// Pipeline: birden çok mesaj tek ağ gidiş-dönüşüyle gider (C#'ta
	// StackExchange.Redis'in IBatch'ine benzer).
	pipe := p.rdb.Pipeline()
	for _, payload := range j.payloads {
		pipe.Publish(ctx, j.channel, payload)
	}
	if _, err := pipe.Exec(ctx); err != nil {
		slog.Warn("redis'e yayınlanamadı", "channel", j.channel, "err", err, "messages", len(j.payloads))
	}
}

func (p *Publisher) enqueue(j job) {
	select {
	case p.queue <- j:
	default:
		// Kuyruk dolu: log gürültüsü olmasın diye her 100 atılışta bir uyar.
		if n := p.dropped.Add(1); n%100 == 1 {
			slog.Warn("yayın kuyruğu dolu, olay atıldı", "atilan_toplam", n)
		}
	}
}

func (p *Publisher) PublishMetrics(events []MetricEvent) {
	payloads := make([][]byte, 0, len(events))
	for _, ev := range events {
		ev.Type = "metric"
		payload, err := json.Marshal(ev)
		if err != nil {
			slog.Error("metrik olayı json'a çevrilemedi", "err", err)
			continue
		}
		payloads = append(payloads, payload)
	}
	if len(payloads) > 0 {
		p.enqueue(job{channel: ChannelMetrics, payloads: payloads})
	}
}

func (p *Publisher) PublishAlert(ev AlertEvent) {
	ev.Type = "alert"
	payload, err := json.Marshal(ev)
	if err != nil {
		slog.Error("alarm olayı json'a çevrilemedi", "err", err)
		return
	}
	p.enqueue(job{channel: ChannelAlerts, payloads: [][]byte{payload}})
}

// PublishRuleDeleted: bir alarm kuralı silindiğinde istemcilere haber verir (bkz. RuleEvent).
func (p *Publisher) PublishRuleDeleted(ruleID int64) {
	payload, err := json.Marshal(RuleEvent{Type: "rule", Event: "deleted", RuleID: ruleID})
	if err != nil {
		slog.Error("kural olayı json'a çevrilemedi", "err", err)
		return
	}
	p.enqueue(job{channel: ChannelAlerts, payloads: [][]byte{payload}})
}
