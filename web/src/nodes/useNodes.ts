import { useMemo } from 'react'
import { nodesApi } from '../api/nodes'
import type { NodeSummary } from '../api/types'
import { useRealtime } from '../realtime/useRealtime'
import { mergeLive } from './live'
import { useLiveMetrics } from './useLiveMetrics'
import { usePolledResource } from './usePolledResource'

/** Liste kaç ms'de bir yenilenir. */
export const NODES_POLL_MS = 10_000

export type NodesState =
  | { status: 'loading' }
  /** refreshError: liste bir kez yüklendikten sonra yapılan yenilemenin başarısız olduğunu söyler;
   *  son bilinen veriler ekranda kalır. */
  | { status: 'ready'; nodes: NodeSummary[]; refreshError: string | null }
  | { status: 'error'; message: string }

/**
 * Sunucu listesini yükler ve `pollMs` aralığıyla yeniler. Yenileme/iptal mantığı genel
 * `usePolledResource` hook'undadır; bu hook yalnızca "neyi çektiğimizi" ve sonucun biçimini bilir.
 */
export function useNodes(pollMs: number = NODES_POLL_MS) {
  // epoch: WebSocket yeniden bağlanınca artar → liste hemen REST'ten yeniden çekilir (kopma sırasında
  // kaçan olaylar için tek doğru kaynak REST'tir).
  const { epoch } = useRealtime()
  const { state, reload } = usePolledResource(nodesApi.list, pollMs, 'Sunucu listesi', epoch)
  const live = useLiveMetrics()

  const nodesState = useMemo<NodesState>(
    () =>
      state.status === 'ready'
        ? { status: 'ready', nodes: mergeLive(state.data, live), refreshError: state.refreshError }
        : state,
    [state, live],
  )

  return { state: nodesState, reload }
}
