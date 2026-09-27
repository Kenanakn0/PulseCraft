import { useEffect, useRef, useState } from 'react'
import { useRealtimeEvents } from '../realtime/useRealtime'
import { eventToLatest, LIVE_ONLINE_MS, type LiveMap } from './live'

/**
 * Canlı "metric" olaylarından sunucu başına son durumu tutar ve her sunucu için bir sessizlik
 * zamanlayıcısı işletir: `onlineMs` (varsayılan LIVE_ONLINE_MS) boyunca yeni olay gelmezse o sunucu çevrimdışı olur.
 * Olaylar EKSİK/GEÇ/TEKRARLI gelebilir (bkz. docs/decisions.md "Real-time delivery"); bu yüzden her olay,
 * o sunucunun bildiği en yeni ölçümden ESKİ ya da aynıysa yok sayılır (idempotent).
 */
export function useLiveMetrics(onlineMs: number = LIVE_ONLINE_MS): LiveMap {
  const [live, setLive] = useState<LiveMap>({})

  // Ref'ler: render etmeyen yardımcı durum (C#'ta özel alanlar).
  const lastTime = useRef(new Map<string, number>())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useRealtimeEvents((event) => {
    if (event.type !== 'metric') return

    const id = event.node_id
    const t = Date.parse(event.time)
    if (t <= (lastTime.current.get(id) ?? Number.NEGATIVE_INFINITY)) return
    lastTime.current.set(id, t)

    clearTimeout(timers.current.get(id))
    timers.current.set(
      id,
      setTimeout(() => {
        setLive((current) => {
          const entry = current[id]
          return entry !== undefined && entry.online ? { ...current, [id]: { ...entry, online: false } } : current
        })
      }, onlineMs),
    )

    setLive((current) => ({ ...current, [id]: { latest: eventToLatest(event), online: true } }))
  })

  // Bileşen kalkarken bekleyen zamanlayıcıları temizle (Dispose).
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    }
  }, [])

  return live
}
