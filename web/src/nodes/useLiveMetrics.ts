import { useEffect, useRef, useState } from 'react'
import { useRealtimeEvents } from '../realtime/useRealtime'
import { eventToLatest, LIVE_ONLINE_MS, type LiveMap } from './live'

/**
 * Keeps the latest state per server from live "metric" events and runs a silence timer per server:
 * without an event for `onlineMs` (default LIVE_ONLINE_MS) the server turns offline. Events can be missing,
 * late or repeated (see docs/decisions.md "Real-time delivery"), so an event not newer than the latest
 * known sample of that server is ignored (idempotent).
 */
export function useLiveMetrics(onlineMs: number = LIVE_ONLINE_MS): LiveMap {
  const [live, setLive] = useState<LiveMap>({})

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

  // Clear pending timers on unmount.
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    }
  }, [])

  return live
}
