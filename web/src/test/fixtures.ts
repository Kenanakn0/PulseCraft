import type { NodeSummary } from '../api/types'

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
