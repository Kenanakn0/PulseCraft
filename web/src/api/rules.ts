import { apiFetch } from './http'
import type { AlertRule, AlertSeverity } from './types'

/** Body of POST/PUT /api/v1/alert-rules (a rule without its id). */
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

  /** The server expects the full body: even when only one field changes (e.g. `enabled`), ALL are sent. */
  update: (id: number, payload: RulePayload) =>
    apiFetch<AlertRule>(`/api/v1/alert-rules/${id}`, { method: 'PUT', body: payload }),

  /** Deletes the rule and ALL of its alert history (cascade). */
  remove: (id: number) => apiFetch<void>(`/api/v1/alert-rules/${id}`, { method: 'DELETE' }),
}
