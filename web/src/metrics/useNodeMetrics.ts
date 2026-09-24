import { useMemo, useState } from 'react'
import { nodesApi } from '../api/nodes'
import { usePolledResource } from '../nodes/usePolledResource'
import { useRealtime, useRealtimeEvents } from '../realtime/useRealtime'
import { appendLive, eventToPoint, mergeLivePoints } from './live'
import { getRange, type RangeId } from './ranges'
import { toChartPoints, type ChartPoint } from './series'

export type MetricsState =
  | { status: 'loading' }
  | {
      status: 'ready'
      points: ChartPoint[]
      /** Verinin hangi tablodan geldiği: ham ölçüm mü, 1 dakikalık özet mi. */
      resolution: 'raw' | '1m'
      /** Grafiğin x ekseni sınırları (ms). SUNUCUnun döndürdüğü pencere: tarayıcı saatine bağlı değil. */
      from: number
      to: number
      refreshError: string | null
    }
  | { status: 'error'; message: string }

/**
 * Bir sunucunun seçili aralıktaki geçmiş ölçümlerini yükler ve aralığa uygun sıklıkta yeniler.
 *
 * `nodeId` ya da `rangeId` değişince bu hook'u kullanan bileşene DEĞİŞEN BİR `key` verilmelidir
 * (bkz. usePolledResource): bileşen sıfırdan kurulur, yükleme durumu temiz başlar.
 */
export function useNodeMetrics(nodeId: string, rangeId: RangeId) {
  const range = getRange(rangeId)

  // Canlı noktalar ayrı bir tamponda birikir; REST verisiyle GÖSTERİMDE birleştirilir (aşağıda).
  const [livePoints, setLivePoints] = useState<readonly ChartPoint[]>([])
  const { epoch } = useRealtime()
  useRealtimeEvents((event) => {
    if (event.type !== 'metric' || event.node_id !== nodeId) return
    setLivePoints((current) => appendLive(current, eventToPoint(event)))
  })

  const { state, reload } = usePolledResource(
    async (signal) => {
      const response = await nodesApi.metrics(nodeId, range.last, signal)
      return {
        points: toChartPoints(response),
        resolution: response.resolution,
        from: Date.parse(response.from),
        to: Date.parse(response.to),
      }
    },
    range.pollMs,
    'Ölçümler',
    epoch, // WebSocket yeniden bağlanınca geçmiş REST'ten yeniden çekilir (kopmada kaçan noktalar tamamlanır)
  )

  const metricsState = useMemo<MetricsState>(() => {
    if (state.status !== 'ready') return state
    const { points, resolution, from, to } = state.data
    // Canlı noktalar yalnızca ham veride (15 dk / 1 sa) anlamlı; dakikalık özet grafiğine karıştırılmaz.
    const merged = resolution === 'raw' ? mergeLivePoints(points, from, to, livePoints) : { points, from, to }
    return { status: 'ready', ...merged, resolution, refreshError: state.refreshError }
  }, [state, livePoints])

  return { state: metricsState, reload }
}
