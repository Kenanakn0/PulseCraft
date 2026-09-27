import { apiFetch } from './http'
import type { CreatedNode, MetricsRangeResponse, NodeSummary } from './types'

export const nodesApi = {
  list: (signal?: AbortSignal) => apiFetch<NodeSummary[]>('/api/v1/nodes', { signal }),

  /** Yeni sunucu. Yanıttaki `api_key` YALNIZCA burada döner: sunucu yalnızca hash'ini saklar. */
  create: (name: string) => apiFetch<CreatedNode>('/api/v1/nodes', { method: 'POST', body: { name } }),

  /** Sunucuyu ve ona bağlı her şeyi (metrikler, alarm geçmişi, yalnızca ona ait kurallar) siler. */
  remove: (id: string) => apiFetch<void>(`/api/v1/nodes/${encodeURIComponent(id)}`, { method: 'DELETE' }),

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
