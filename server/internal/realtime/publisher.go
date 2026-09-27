package realtime

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
)

const publishTimeout = 2 * time.Second

// queueSize bounds pending publishes: if Redis is slow or down, new events are dropped instead of
// growing memory without limit.
const queueSize = 1024

type job struct {
	channel  string
	payloads [][]byte
}

// Publisher never makes the request path wait for Redis: PublishX queues the event and a single worker
// (Run) writes to Redis. When publishing was synchronous, a Redis outage slowed ingest enough for agents
// to time out and re-send batches. Live delivery is best effort; stored data is unaffected.
type Publisher struct {
	rdb     *redis.Client
	queue   chan job
	dropped atomic.Int64
}

func NewPublisher(rdb *redis.Client) *Publisher {
	return &Publisher{rdb: rdb, queue: make(chan job, queueSize)}
}

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

	// A pipeline sends several messages in one round trip.
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
		// Queue full: warn only every 100 drops to keep the log readable.
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

func (p *Publisher) PublishRuleDeleted(ruleID int64) {
	payload, err := json.Marshal(RuleEvent{Type: "rule", Event: "deleted", RuleID: ruleID})
	if err != nil {
		slog.Error("kural olayı json'a çevrilemedi", "err", err)
		return
	}
	p.enqueue(job{channel: ChannelAlerts, payloads: [][]byte{payload}})
}

func (p *Publisher) PublishNodeDeleted(nodeID string) {
	payload, err := json.Marshal(NodeEvent{Type: "node", Event: "deleted", NodeID: nodeID})
	if err != nil {
		slog.Error("sunucu olayı json'a çevrilemedi", "err", err)
		return
	}
	p.enqueue(job{channel: ChannelAlerts, payloads: [][]byte{payload}})
}
