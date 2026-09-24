import { apiFetch } from './http'
import type { MetricsRangeResponse, NodeSummary } from './types'

export const nodesApi = {
  list: (signal?: AbortSignal) => apiFetch<NodeSummary[]>('/api/v1/nodes', { signal }),

  /**
   * Bir sunucunun geçmiş ölçümleri. `last` ("15m", "1h", "6h"…) pencereyi SUNUCU saatine göre
   * kurar; tarayıcı saati yanlış olsa da doğru aralık gelir (bu yüzden from/to kullanılmıyor).
   * Sunucu, aralık ≤ 3 saatse ham veriyi, daha uzunsa 1 dakikalık özeti döndürür.
   */
  metrics: (nodeId: string, last: string, signal?: AbortSignal) =>
    apiFetch<MetricsRangeResponse>(
      `/api/v1/nodes/${encodeURIComponent(nodeId)}/metrics?last=${encodeURIComponent(last)}`,
      { signal },
    ),
}
