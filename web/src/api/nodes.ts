import { apiFetch } from './http'
import type { NodeSummary } from './types'

export const nodesApi = {
  list: (signal?: AbortSignal) => apiFetch<NodeSummary[]>('/api/v1/nodes', { signal }),
}
