import type { AggMetricPoint, MetricsRangeResponse, NodeSummary, RawMetricPoint } from '../api/types'

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
