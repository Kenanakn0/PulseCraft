package realtime

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"
)

// Publisher: olayları Redis kanallarına yayınlar. Redis erişilemezse hata
// sadece loglanır — canlı yayın kaybı, metrik kaydını (asıl iş) bozmamalı.
type Publisher struct {
	rdb *redis.Client
}

func NewPublisher(rdb *redis.Client) *Publisher {
	return &Publisher{rdb: rdb}
}

// publishTimeout: Redis takılırsa HTTP isteğini sonsuza dek bekletmemek için.
const publishTimeout = 2 * time.Second

// PublishMetrics: birden çok örneği tek bir Redis pipeline'ında yayınlar
// (tek ağ gidiş-dönüşü; C#'ta StackExchange.Redis'in IBatch'ine benzer).
func (p *Publisher) PublishMetrics(ctx context.Context, events []MetricEvent) {
	if len(events) == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, publishTimeout)
	defer cancel()

	pipe := p.rdb.Pipeline()
	for _, ev := range events {
		ev.Type = "metric"
		payload, err := json.Marshal(ev)
		if err != nil {
			slog.Error("metrik olayı json'a çevrilemedi", "err", err)
			continue
		}
		pipe.Publish(ctx, ChannelMetrics, payload)
	}
	if _, err := pipe.Exec(ctx); err != nil {
		slog.Warn("metrikler redis'e yayınlanamadı", "err", err, "count", len(events))
	}
}

func (p *Publisher) PublishAlert(ctx context.Context, ev AlertEvent) {
	ctx, cancel := context.WithTimeout(ctx, publishTimeout)
	defer cancel()

	ev.Type = "alert"
	payload, err := json.Marshal(ev)
	if err != nil {
		slog.Error("alarm olayı json'a çevrilemedi", "err", err)
		return
	}
	if err := p.rdb.Publish(ctx, ChannelAlerts, payload).Err(); err != nil {
		slog.Warn("alarm redis'e yayınlanamadı", "err", err, "alert_id", ev.AlertID)
	}
}
