import { apiFetch } from './http'
import type { AlertRule, AlertSeverity } from './types'

/** POST/PUT /api/v1/alert-rules gövdesi (kuralın kimliksiz hâli). */
export interface RulePayload {
  name: string
  node_id: string | null
  metric: string
  operator: string
  threshold: number
  duration_seconds: number
  severity: AlertSeverity
  enabled: boolean
}

export const rulesApi = {
  list: (signal?: AbortSignal) => apiFetch<AlertRule[]>('/api/v1/alert-rules', { signal }),

  create: (payload: RulePayload) => apiFetch<AlertRule>('/api/v1/alert-rules', { method: 'POST', body: payload }),

  /** Sunucu tam gövde ister: alanlardan yalnızca biri değişse de (ör. `enabled`) TÜMÜ gönderilir. */
  update: (id: number, payload: RulePayload) =>
    apiFetch<AlertRule>(`/api/v1/alert-rules/${id}`, { method: 'PUT', body: payload }),

  /** Kuralı ve ona bağlı TÜM alarm geçmişini (cascade) siler. */
  remove: (id: number) => apiFetch<void>(`/api/v1/alert-rules/${id}`, { method: 'DELETE' }),
}
