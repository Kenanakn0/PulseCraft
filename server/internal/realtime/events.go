package realtime

import "time"

// Redis Pub/Sub kanalları.
const (
	ChannelMetrics = "pulsecraft:metrics"
	ChannelAlerts  = "pulsecraft:alerts"
)

// MetricEvent: bir sunucudan gelen yeni metrik örneği. WebSocket istemcilerine
// olduğu gibi iletilir; "type" alanı istemcinin mesajı ayırt etmesi içindir.
type MetricEvent struct {
	Type         string    `json:"type"` // "metric"
	NodeID       string    `json:"node_id"`
	Time         time.Time `json:"time"`
	CPUPercent   float64   `json:"cpu_percent"`
	MemPercent   float64   `json:"mem_percent"`
	MemUsedBytes uint64    `json:"mem_used_bytes"`
	DiskPercent  float64   `json:"disk_percent"`
	NetRxBps     int64     `json:"net_rx_bps"`
	NetTxBps     int64     `json:"net_tx_bps"`
	Load1        *float64  `json:"load1,omitempty"`
}

// AlertEvent: bir alarmın yaşam döngüsündeki değişiklik.
type AlertEvent struct {
	Type         string    `json:"type"`  // "alert"
	Event        string    `json:"event"` // "opened" | "acknowledged" | "resolved"
	AlertID      int64     `json:"alert_id"`
	RuleID       int64     `json:"rule_id"`
	RuleName     string    `json:"rule_name"`
	NodeID       string    `json:"node_id"`
	NodeName     string    `json:"node_name"`
	Severity     string    `json:"severity"`
	Metric       string    `json:"metric"`
	Operator     string    `json:"operator"`
	Threshold    float64   `json:"threshold"`
	TriggerValue float64   `json:"trigger_value"`
	Status       string    `json:"status"`
	TriggeredAt  time.Time `json:"triggered_at"`

	// İstemci, olaydan alarm satırını REST'e gitmeden kurabilsin diye olay alarmın TÜM
	// alanlarını taşır (GET /api/v1/alerts satırıyla aynı bilgi). Henüz olmamış zamanlar null.
	AcknowledgedAt *time.Time `json:"acknowledged_at"`
	ResolvedAt     *time.Time `json:"resolved_at"`

	// AcknowledgedBy: alarmı "incelemeye alan" kullanıcının görünen adı. İncelemeye alınmış
	// alarmın "acknowledged" ve sonradan gelen "resolved" olaylarında dolu, aksi halde JSON'da yok.
	AcknowledgedBy string `json:"acknowledged_by,omitempty"`
}

// RuleEvent: alarm kuralıyla ilgili değişiklik. Şimdilik yalnızca "deleted": kural silinince
// ona bağlı TÜM alarm satırları (geçmiş dahil) veritabanından cascade ile silinir; istemciler
// bu olayla o kurala ait satırları listelerinden atar.
type RuleEvent struct {
	Type   string `json:"type"`  // "rule"
	Event  string `json:"event"` // "deleted"
	RuleID int64  `json:"rule_id"`
}
