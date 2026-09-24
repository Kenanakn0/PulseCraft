import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { alertsApi } from '../api/alerts'
import { ApiError } from '../api/http'
import type { AlertRow, AlertStatus } from '../api/types'
import { usePolledResource } from '../nodes/usePolledResource'
import { useRealtime, useRealtimeEvents } from '../realtime/useRealtime'
import { AlertsContext, type AckResult, type AlertsContextValue, type AlertsState } from './alertsContext'
import { eventReducer, initialEventState, mergeAlerts } from './state'

/**
 * REST'ten tam eşitleme aralığı. Canlı olaylar asıl kaynaktır; bu yoklama GÜVENLİK AĞIDIR: sunucuda Redis
 * kesilirse olaylar kaybolur ama WebSocket bağlantısı AÇIK kalır (yeniden bağlanma olmaz), yani panel sessizce
 * bayatlardı. Yeniden bağlanmada ayrıca hemen eşitlenir (epoch).
 */
export const ALERTS_SYNC_MS = 60_000

const STATUSES: AlertStatus[] = ['open', 'acknowledged', 'resolved']

/**
 * Üç durumu AYRI ister: sunucu her sorguda en yeni 200 kaydı döndürür; tek sorguyla (durum filtresiz) çok
 * sayıda yeni "resolved" kaydı, hâlâ açık olan ESKİ bir alarmı 200'ün dışına iterdi.
 */
async function fetchAllAlerts(signal: AbortSignal): Promise<AlertRow[]> {
  const parts = await Promise.all(STATUSES.map((status) => alertsApi.list(status, signal)))
  return parts.flat()
}

interface AlertsProviderProps {
  children: ReactNode
  syncMs?: number
}

/**
 * Alarmların TEK paylaşılan kaynağı (üst çubuk sayacı ve alarm panosu aynı listeyi okur; C#'ta scoped bir
 * servis ya da Blazor `CascadingValue` gibi). İki kaynağı birleştirir:
 *  1) REST anlık görüntüsü (açılışta, yeniden bağlanınca, 60 sn'de bir, ack çakışmasında),
 *  2) WebSocket olayları (anında).
 * Birleştirme kuralları `alerts/state.ts`'te, saf fonksiyonlar olarak test edilir.
 */
export function AlertsProvider({ children, syncMs = ALERTS_SYNC_MS }: AlertsProviderProps) {
  const [events, dispatch] = useReducer(eventReducer, initialEventState)

  // Anlık görüntünün isteği BAŞLARKEN olay sayacı ne idi? (mergeAlerts bunu kullanır.) Fetcher çizim
  // sırasında değil zamanlayıcıda/effect'te çalıştığı için ref'ten okumak güvenlidir.
  const eventsRef = useRef(events)
  useEffect(() => {
    eventsRef.current = events
  })

  useRealtimeEvents((event) => {
    if (event.type === 'alert') dispatch({ type: 'alert', event })
    else if (event.type === 'rule') dispatch({ type: 'ruleDeleted', ruleId: event.rule_id })
  })

  // Yeniden bağlanma (epoch) ya da elle istek (manualSync) → yükleme durumuna DÖNMEDEN hemen yeniden eşitle.
  const { epoch } = useRealtime()
  const [manualSync, setManualSync] = useState(0)

  const { state: snapshot, reload } = usePolledResource(
    async (signal) => {
      const startSeq = eventsRef.current.seq
      return { alerts: await fetchAllAlerts(signal), startSeq }
    },
    syncMs,
    'Alarmlar',
    epoch + manualSync, // ikisi de yalnızca artar: toplam her artışta değişir
  )

  const state = useMemo<AlertsState>(() => {
    if (snapshot.status !== 'ready') return snapshot
    return {
      status: 'ready',
      alerts: mergeAlerts(snapshot.data.alerts, snapshot.data.startSeq, events),
      refreshError: snapshot.refreshError,
    }
  }, [snapshot, events])

  const acknowledge = useCallback(async (id: number): Promise<AckResult> => {
    try {
      const event = await alertsApi.acknowledge(id)
      if (event === null) setManualSync((n) => n + 1) // yanıt çözümlenemedi: işlem yapıldı, doğruyu REST'ten al
      else dispatch({ type: 'alert', event }) // WebSocket olayı da gelecek; ikinci uygulama etkisizdir (idempotent)
      return { kind: 'ok' }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setManualSync((n) => n + 1)
          return { kind: 'conflict', message: 'Bu alarm artık açık değil: başkası incelemeye almış ya da çözülmüş olabilir.' }
        }
        if (err.status === 404) {
          setManualSync((n) => n + 1)
          return { kind: 'conflict', message: 'Alarm bulunamadı (kuralı silinmiş olabilir).' }
        }
        if (err.status === 0) return { kind: 'error', message: 'Sunucuya ulaşılamadı.' }
        return { kind: 'error', message: `İşlem başarısız (HTTP ${err.status}).` }
      }
      throw err
    }
  }, [])

  const value = useMemo<AlertsContextValue>(() => ({ state, acknowledge, reload }), [state, acknowledge, reload])

  return <AlertsContext value={value}>{children}</AlertsContext>
}
