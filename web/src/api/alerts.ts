import { apiFetch } from './http'
import type { AlertRow, AlertStatus } from './types'
import { parseEvent, type AlertEvent } from '../realtime/events'

export const alertsApi = {
  /** Alerts with the given status (the server returns the newest 200). */
  list: (status: AlertStatus, signal?: AbortSignal) =>
    apiFetch<AlertRow[]>(`/api/v1/alerts?status=${status}`, { signal }),

  /**
   * Acknowledges an `open` alert; if someone was faster the server answers 409. The response is the same
   * full alert event that is broadcast over the WebSocket; `null` if it cannot be parsed (the action still
   * happened on the server, so the caller should resync).
   */
  acknowledge: async (id: number): Promise<AlertEvent | null> => {
    const body = await apiFetch<unknown>(`/api/v1/alerts/${id}/ack`, { method: 'POST' })
    // The response goes through the same strict validator as WebSocket events (parseEvent).
    const event = parseEvent(JSON.stringify(body))
    return event?.type === 'alert' ? event : null
  },
}
