import { useMemo } from 'react'
import { nodesApi } from '../api/nodes'
import { usePolledResource } from '../nodes/usePolledResource'
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
  )

  const metricsState = useMemo<MetricsState>(
    () => (state.status === 'ready' ? { status: 'ready', ...state.data, refreshError: state.refreshError } : state),
    [state],
  )

  return { state: metricsState, reload }
}
