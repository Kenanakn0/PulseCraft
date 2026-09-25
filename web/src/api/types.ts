// Sunucunun JSON sözleşmesi. Alan adları sunucudakiyle (snake_case) birebir aynıdır.
// TypeScript'te `interface`, C#'taki bir DTO'ya/record'a benzer, ama YAPISALDIR: bir nesne
// bu alanlara sahipse, adı ne olursa olsun bu tipe uyar (C#'ta uyum isimle/kalıtımla olur).

export interface User {
  id: number
  email: string
  display_name: string
}

/** POST /api/v1/auth/login yanıtı. */
export interface LoginResponse {
  user: User
}

/** Bir sunucunun (node) en son kaydedilmiş ölçümü. */
export interface NodeLatest {
  /** Ölçümün zamanı (ISO 8601). */
  time: string
  cpu_percent: number
  mem_percent: number
  mem_used_bytes: number
  disk_percent: number
  net_rx_bps: number
  net_tx_bps: number
  /** Windows'ta yoktur → `null` (C#'taki `double?`). */
  load1: number | null
}

/**
 * GET /api/v1/nodes listesindeki bir sunucu. `online` ve `last_seen_seconds_ago`
 * SUNUCUDA hesaplanır: tarayıcı saatinin yanlış olması durumu etkilemez.
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
  /** Hiç görülmediyse `null`. */
  last_seen_seconds_ago: number | null
  /** Hiç ölçümü yoksa `null`. */
  latest: NodeLatest | null
}

/** `metrics` tablosundan (ham veri) gelen nokta. */
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

/** `metrics_1m` özetinden (1 dakikalık ortalama/maksimum) gelen nokta. */
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
 * GET /api/v1/nodes/{id}/metrics yanıtı. `resolution` hangi tablodan okunduğunu söyler ve
 * `points`'in şeklini belirler (TypeScript'te ayırt edilmiş birleşim / discriminated union:
 * `resolution` alanına bakınca derleyici doğru nokta tipini bilir; C#'ta bir sınıf hiyerarşisi
 * + `switch` ifadesi gibi düşünülebilir).
 */
export type MetricsRangeResponse =
  | { resolution: 'raw'; from: string; to: string; points: RawMetricPoint[] }
  | { resolution: '1m'; from: string; to: string; points: AggMetricPoint[] }

/** GET /api/v1/auth/me yanıtı. */
export interface MeResponse {
  user: User
  /** Oturumun sona ereceği an (ISO 8601). */
  expires_at: string
}

export type AlertStatus = 'open' | 'acknowledged' | 'resolved'
export type AlertSeverity = 'info' | 'warning' | 'critical'

/**
 * Bir alarm satırı: hem GET /api/v1/alerts yanıtındaki bir öğe hem de bir WebSocket alarm olayından
 * kurulan satır aynı biçimdedir (4.2a: olay alarmın tüm alanlarını taşır).
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
  /** İncelemeye alınmadıysa `null`. */
  acknowledged_at: string | null
  /** İncelemeye alanın görünen adı; alınmadıysa `null`. */
  acknowledged_by: string | null
  /** Çözülmediyse `null`. */
  resolved_at: string | null
}

/** GET/POST/PUT /api/v1/alert-rules'ta bir alarm kuralı. */
export interface AlertRule {
  id: number
  name: string
  /** `null` = tüm sunucular. */
  node_id: string | null
  metric: string
  operator: string
  threshold: number
  duration_seconds: number
  severity: AlertSeverity
  enabled: boolean
  created_at: string
}
