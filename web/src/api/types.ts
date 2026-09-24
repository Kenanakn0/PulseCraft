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

/** GET /api/v1/auth/me yanıtı. */
export interface MeResponse {
  user: User
  /** Oturumun sona ereceği an (ISO 8601). */
  expires_at: string
}
