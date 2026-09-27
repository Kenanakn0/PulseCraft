// The server's JSON contract; field names match the server exactly (snake_case).

export interface User {
  id: number
  email: string
  display_name: string
}

export interface LoginResponse {
  user: User
}

export interface NodeLatest {
  /** Sample time (ISO 8601). */
  time: string
  cpu_percent: number
  mem_percent: number
  mem_used_bytes: number
  disk_percent: number
  net_rx_bps: number
  net_tx_bps: number
  /** `null` where the platform has no load average (Windows). */
  load1: number | null
}

/**
 * A server in GET /api/v1/nodes. `online` and `last_seen_seconds_ago` are computed on the SERVER, so a
 * wrong browser clock cannot affect them.
 */
export interface NodeSummary {
  id: string
  name: string
  hostname: string | null
  os: string | null
  is_active: boolean
  last_seen_at: string | null
  created_at: string
  online: boolean
  /** `null` if never seen. */
  last_seen_seconds_ago: number | null
  /** `null` without any sample. */
  latest: NodeLatest | null
}

/** Point from the raw `metrics` table. */
export interface RawMetricPoint {
  time: string
  cpu_percent: number
  mem_percent: number
  mem_used_bytes: number
  disk_percent: number
  net_rx_bps: number
  net_tx_bps: number
  load1?: number
}

/** Point from the `metrics_1m` aggregate (1-minute average/maximum). */
export interface AggMetricPoint {
  time: string
  cpu_avg: number
  cpu_max: number
  mem_avg: number
  mem_max: number
  disk_avg: number
  net_rx_avg: number
  net_tx_avg: number
}

/**
 * GET /api/v1/nodes/{id}/metrics response. `resolution` tells which table was read and determines the
 * shape of `points` (a discriminated union).
 */
export type MetricsRangeResponse =
  | { resolution: 'raw'; from: string; to: string; points: RawMetricPoint[] }
  | { resolution: '1m'; from: string; to: string; points: AggMetricPoint[] }

export interface MeResponse {
  user: User
  /** When the session expires (ISO 8601). */
  expires_at: string
}

export type AlertStatus = 'open' | 'acknowledged' | 'resolved'
export type AlertSeverity = 'info' | 'warning' | 'critical'

/**
 * An alert row: an item of GET /api/v1/alerts and a row built from a WebSocket alert event have the same
 * shape (events carry the full row).
 */
export interface AlertRow {
  id: number
  rule_id: number
  rule_name: string
  severity: AlertSeverity
  metric: string
  operator: string
  threshold: number
  node_id: string
  node_name: string
  status: AlertStatus
  trigger_value: number
  triggered_at: string
  /** `null` unless acknowledged. */
  acknowledged_at: string | null
  /** Display name of the acknowledging user; `null` unless acknowledged. */
  acknowledged_by: string | null
  /** `null` unless resolved. */
  resolved_at: string | null
}

export interface AlertRule {
  id: number
  name: string
  /** `null` = all servers. */
  node_id: string | null
  metric: string
  operator: string
  threshold: number
  duration_seconds: number
  severity: AlertSeverity
  enabled: boolean
  created_at: string
}

/** POST /api/v1/nodes response. The plain `api_key` is returned only once. */
export interface CreatedNode {
  id: string
  name: string
  api_key: string
}
