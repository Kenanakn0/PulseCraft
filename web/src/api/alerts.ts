import { apiFetch } from './http'
import type { AlertRow, AlertStatus } from './types'
import { parseEvent, type AlertEvent } from '../realtime/events'

export const alertsApi = {
  /** Belirli durumdaki alarmlar (sunucu en yeni 200 taneyi döndürür). */
  list: (status: AlertStatus, signal?: AbortSignal) =>
    apiFetch<AlertRow[]>(`/api/v1/alerts?status=${status}`, { signal }),

  /**
   * "İncelemeye aldım". Yalnızca `open` alarm incelemeye alınabilir; başkası önce davrandıysa sunucu 409
   * döner (ApiError.status === 409). Yanıt, WebSocket'e yayınlananla aynı zengin alarm olayıdır;
   * çözümlenemezse `null` döner (işlem sunucuda yine de yapılmıştır: çağıran REST'ten senkronlamalı).
   */
  acknowledge: async (id: number): Promise<AlertEvent | null> => {
    const body = await apiFetch<unknown>(`/api/v1/alerts/${id}/ack`, { method: 'POST' })
    // Aynı sıkı doğrulayıcıdan (parseEvent) geçirilir: sunucu yanıtı da WebSocket'teki gibi doğrulanır.
    const event = parseEvent(JSON.stringify(body))
    return event?.type === 'alert' ? event : null
  },
}
