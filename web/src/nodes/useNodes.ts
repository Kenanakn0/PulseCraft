import { useMemo, useState } from 'react'
import { nodesApi } from '../api/nodes'
import type { NodeSummary } from '../api/types'
import { useRealtime, useRealtimeEvents } from '../realtime/useRealtime'
import { mergeLive } from './live'
import { useLiveMetrics } from './useLiveMetrics'
import { usePolledResource } from './usePolledResource'

export const NODES_POLL_MS = 10_000

export type NodesState =
  | { status: 'loading' }
  /** refreshError: a refresh after the first successful load failed; the last known data stays on screen. */
  | { status: 'ready'; nodes: NodeSummary[]; refreshError: string | null }
  | { status: 'error'; message: string }

/**
 * Loads the server list and refreshes it every `pollMs`. The polling/cancellation logic lives in
 * usePolledResource; this hook only knows what to fetch.
 */
export function useNodes(pollMs: number = NODES_POLL_MS) {
  // epoch increases on every WebSocket reconnect → refetch from REST right away (REST is the only reliable
  // source for events missed while disconnected).
  const { epoch } = useRealtime()
  const { state, reload } = usePolledResource(nodesApi.list, pollMs, 'Sunucu listesi', epoch)
  const live = useLiveMetrics()

  // A server deleted elsewhere drops out of the list without waiting for the next poll.
  const [deleted, setDeleted] = useState<readonly string[]>([])
  useRealtimeEvents((event) => {
    if (event.type === 'node') setDeleted((ids) => (ids.includes(event.node_id) ? ids : [...ids, event.node_id]))
  })

  const nodesState = useMemo<NodesState>(
    () =>
      state.status === 'ready'
        ? {
            status: 'ready',
            nodes: mergeLive(state.data, live).filter((n) => !deleted.includes(n.id)),
            refreshError: state.refreshError,
          }
        : state,
    [state, live, deleted],
  )

  return { state: nodesState, reload }
}
