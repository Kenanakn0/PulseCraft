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
      /** Which table the data came from: raw samples or the 1-minute aggregate. */
      resolution: 'raw' | '1m'
      /** x-axis bounds (ms): the window returned by the SERVER, independent of the browser clock. */
      from: number
      to: number
      refreshError: string | null
    }
  | { status: 'error'; message: string }

/**
 * Loads a server's history for the selected range and refreshes it at a range-appropriate interval. Give
 * the component a new `key` when `nodeId` or `rangeId` changes (see usePolledResource).
 */
export function useNodeMetrics(nodeId: string, rangeId: RangeId) {
  const range = getRange(rangeId)

  // Live points collect in their own buffer and are merged with the REST data at render time (below).
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
    epoch, // after a WebSocket reconnect the history is refetched (fills points missed while disconnected)
  )

  const metricsState = useMemo<MetricsState>(() => {
    if (state.status !== 'ready') return state
    const { points, resolution, from, to } = state.data
    // Live points only make sense for raw ranges (15 min / 1 h); they are never mixed into the aggregate chart.
    const merged = resolution === 'raw' ? mergeLivePoints(points, from, to, livePoints) : { points, from, to }
    return { status: 'ready', ...merged, resolution, refreshError: state.refreshError }
  }, [state, livePoints])

  return { state: metricsState, reload }
}
