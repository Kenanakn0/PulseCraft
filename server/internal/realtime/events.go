package realtime

import "time"

const (
	ChannelMetrics = "pulsecraft:metrics"
	ChannelAlerts  = "pulsecraft:alerts"
)

// MetricEvent is forwarded to WebSocket clients as is; Type lets clients tell messages apart.
type MetricEvent struct {
	Type         string    `json:"type"`
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

type AlertEvent struct {
	Type         string    `json:"type"`
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

	// The event carries the full alert row (same as GET /api/v1/alerts), so clients can build the row
	// without a REST call. Times that have not happened yet are null.
	AcknowledgedAt *time.Time `json:"acknowledged_at"`
	ResolvedAt     *time.Time `json:"resolved_at"`

	// AcknowledgedBy is the display name of the acknowledging user; set on "acknowledged" and later
	// "resolved" events, absent otherwise.
	AcknowledgedBy string `json:"acknowledged_by,omitempty"`
}

// RuleEvent: currently only "deleted". Deleting a rule cascades to all of its alert rows (history
// included), so clients drop those rows.
type RuleEvent struct {
	Type   string `json:"type"`
	Event  string `json:"event"`
	RuleID int64  `json:"rule_id"`
}

// NodeEvent: a node was deleted. Its alert rows went with it (cascade), so clients drop them. Published
// on the alerts channel.
type NodeEvent struct {
	Type   string `json:"type"`
	Event  string `json:"event"`
	NodeID string `json:"node_id"`
}
