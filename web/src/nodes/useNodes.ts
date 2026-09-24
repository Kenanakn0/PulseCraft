import { useMemo } from 'react'
import { nodesApi } from '../api/nodes'
import type { NodeSummary } from '../api/types'
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
  const { state, reload } = usePolledResource(nodesApi.list, pollMs, 'Sunucu listesi')

  const nodesState = useMemo<NodesState>(
    () => (state.status === 'ready' ? { status: 'ready', nodes: state.data, refreshError: state.refreshError } : state),
    [state],
  )

  return { state: nodesState, reload }
}
