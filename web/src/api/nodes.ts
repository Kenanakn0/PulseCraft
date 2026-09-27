import { apiFetch } from './http'
import type { CreatedNode, MetricsRangeResponse, NodeSummary } from './types'

export const nodesApi = {
  list: (signal?: AbortSignal) => apiFetch<NodeSummary[]>('/api/v1/nodes', { signal }),

  /** Creates a server. The returned `api_key` appears ONLY here: the server stores just its hash. */
  create: (name: string) => apiFetch<CreatedNode>('/api/v1/nodes', { method: 'POST', body: { name } }),

  /** Deletes the server and everything tied to it (metrics, alert history, rules scoped to it). */
  remove: (id: string) => apiFetch<void>(`/api/v1/nodes/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /**
   * A server's past samples. `last` ("15m", "1h", "6h" …) builds the window from the SERVER clock, so a
   * wrong browser clock cannot shift it (hence no from/to). Ranges up to 3 hours return raw data, longer
   * ranges the 1-minute aggregate.
   */
  metrics: (nodeId: string, last: string, signal?: AbortSignal) =>
    apiFetch<MetricsRangeResponse>(
      `/api/v1/nodes/${encodeURIComponent(nodeId)}/metrics?last=${encodeURIComponent(last)}`,
      { signal },
    ),
}
