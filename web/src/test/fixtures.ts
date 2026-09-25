import type { AggMetricPoint, AlertRow, AlertRule, MetricsRangeResponse, NodeSummary, RawMetricPoint } from '../api/types'

/** Testlerde kullanılan örnek sunucu; `overrides` ile alanlar değiştirilir. */
export function makeNode(overrides: Partial<NodeSummary> = {}): NodeSummary {
  return {
    id: 'node-1',
    name: 'web-01',
    hostname: 'web-01.example.test',
    os: 'linux',
    is_active: true,
    last_seen_at: '2030-01-01T00:00:00Z',
    created_at: '2029-12-01T00:00:00Z',
    online: true,
    last_seen_seconds_ago: 2,
    latest: {
      time: '2030-01-01T00:00:00Z',
      cpu_percent: 42.5,
      mem_percent: 61,
      mem_used_bytes: 8_000_000_000,
      disk_percent: 70.25,
      net_rx_bps: 1200,
      net_tx_bps: 300,
      load1: null,
    },
    ...overrides,
  }
}

export function rawPoint(time: string, overrides: Partial<RawMetricPoint> = {}): RawMetricPoint {
  return {
    time,
    cpu_percent: 10,
    mem_percent: 20,
    mem_used_bytes: 1,
    disk_percent: 30,
    net_rx_bps: 100,
    net_tx_bps: 50,
    ...overrides,
  }
}

export function aggPoint(time: string, overrides: Partial<AggMetricPoint> = {}): AggMetricPoint {
  return {
    time,
    cpu_avg: 11,
    cpu_max: 15,
    mem_avg: 21,
    mem_max: 25,
    disk_avg: 31,
    net_rx_avg: 110,
    net_tx_avg: 55,
    ...overrides,
  }
}

export function rawResponse(points: RawMetricPoint[]): MetricsRangeResponse {
  return { resolution: 'raw', from: '2030-01-01T00:00:00Z', to: '2030-01-01T00:15:00Z', points }
}

export function aggResponse(points: AggMetricPoint[]): MetricsRangeResponse {
  return { resolution: '1m', from: '2030-01-01T00:00:00Z', to: '2030-01-01T06:00:00Z', points }
}

/** Testlerde kullanılan örnek alarm satırı (`GET /alerts` biçimi). */
export function makeAlert(overrides: Partial<AlertRow> = {}): AlertRow {
  return {
    id: 1,
    rule_id: 10,
    rule_name: 'Yüksek CPU',
    severity: 'critical',
    metric: 'cpu_percent',
    operator: '>',
    threshold: 90,
    node_id: 'node-1',
    node_name: 'web-01',
    status: 'open',
    trigger_value: 93.2,
    triggered_at: '2030-01-01T10:00:00Z',
    acknowledged_at: null,
    acknowledged_by: null,
    resolved_at: null,
    ...overrides,
  }
}

/** Sunucunun WebSocket'e yayınladığı alarm olayı (satırın tüm alanları + `type`/`event`/`alert_id`). */
export function alertEventPayload(overrides: Partial<AlertRow> & { event?: string } = {}) {
  const { event = 'opened', ...rowOverrides } = overrides
  const { id, ...row } = makeAlert(rowOverrides)
  const statusEvent = event
  const payload: Record<string, unknown> = { type: 'alert', event: statusEvent, alert_id: id, ...row }
  // Sunucu, alanı yalnızca doluyken gönderir (`omitempty`).
  if (row.acknowledged_by === null) delete payload.acknowledged_by
  return payload
}

/** Testlerde kullanılan örnek alarm kuralı. */
export function makeRule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 1,
    name: 'Yüksek CPU',
    node_id: null,
    metric: 'cpu_percent',
    operator: '>',
    threshold: 90,
    duration_seconds: 0,
    severity: 'critical',
    enabled: true,
    created_at: '2029-12-01T00:00:00Z',
    ...overrides,
  }
}
