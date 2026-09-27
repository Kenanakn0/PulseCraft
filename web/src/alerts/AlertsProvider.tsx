import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { alertsApi } from '../api/alerts'
import { ApiError } from '../api/http'
import type { AlertRow, AlertStatus } from '../api/types'
import { usePolledResource } from '../nodes/usePolledResource'
import { useRealtime, useRealtimeEvents } from '../realtime/useRealtime'
import { AlertsContext, type AckResult, type AlertsContextValue, type AlertsState } from './alertsContext'
import { eventReducer, initialEventState, mergeAlerts } from './state'

/**
 * Full REST resync interval. Live events are the primary source; this is a SAFETY NET: when Redis fails
 * on the server, events are lost while the WebSocket stays OPEN (no reconnect), so the board would go
 * stale silently. A reconnect also resyncs immediately (epoch).
 */
export const ALERTS_SYNC_MS = 60_000

const STATUSES: AlertStatus[] = ['open', 'acknowledged', 'resolved']

/**
 * Requests the three statuses SEPARATELY: the server returns the newest 200 per query, and with a single
 * unfiltered query many new "resolved" rows would push an older, still open alert out of the 200.
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
 * The single shared source of alerts (the nav badge and the board read the same list). It merges a REST
 * snapshot (on start, on reconnect, every 60 s, after an ack conflict) with live WebSocket events; the
 * merge rules live in `alerts/state.ts` as pure, tested functions.
 */
export function AlertsProvider({ children, syncMs = ALERTS_SYNC_MS }: AlertsProviderProps) {
  const [events, dispatch] = useReducer(eventReducer, initialEventState)

  // The event counter at the moment the snapshot request STARTED (used by mergeAlerts). The fetcher runs
  // in a timer/effect, not during render, so reading the ref is safe.
  const eventsRef = useRef(events)
  useEffect(() => {
    eventsRef.current = events
  })

  useRealtimeEvents((event) => {
    if (event.type === 'alert') dispatch({ type: 'alert', event })
    else if (event.type === 'rule') dispatch({ type: 'ruleDeleted', ruleId: event.rule_id })
    else if (event.type === 'node') dispatch({ type: 'nodeDeleted', nodeId: event.node_id })
  })

  // Reconnect (epoch) or a manual request (manualSync): resync right away without going back to loading.
  const { epoch } = useRealtime()
  const [manualSync, setManualSync] = useState(0)

  const { state: snapshot, reload } = usePolledResource(
    async (signal) => {
      const startSeq = eventsRef.current.seq
      return { alerts: await fetchAllAlerts(signal), startSeq }
    },
    syncMs,
    'Alarmlar',
    epoch + manualSync, // both only increase, so the sum changes on every increment
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
      if (event === null) setManualSync((n) => n + 1) // response could not be parsed: the action happened, take the truth from REST
      else dispatch({ type: 'alert', event }) // the WebSocket event will arrive too; applying it again has no effect (idempotent)
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
