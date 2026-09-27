import type { MetricsRangeResponse } from '../api/types'

/** Common shape of raw and aggregated data used by the charts. */
export interface ChartPoint {
  /** Time (ms since epoch). */
  t: number
  cpu: number
  mem: number
  disk: number
  /** Received / sent (bytes per second). */
  rx: number
  tx: number
}

/**
 * Upper bound of points kept and drawn. The selected window is already bounded (15 min … 24 h) and
 * Chart.js decimates further; this cap is the last guard against an unexpectedly large response.
 */
export const MAX_POINTS = 2000

/**
 * Converts the server response to common points: raw and aggregated data get the same shape, rows with
 * non-numeric values are dropped, and points are sorted by time.
 */
export function toChartPoints(response: MetricsRangeResponse): ChartPoint[] {
  const points: ChartPoint[] =
    response.resolution === 'raw'
      ? response.points.map((p) => ({
          t: Date.parse(p.time),
          cpu: p.cpu_percent,
          mem: p.mem_percent,
          disk: p.disk_percent,
          rx: p.net_rx_bps,
          tx: p.net_tx_bps,
        }))
      : response.points.map((p) => ({
          t: Date.parse(p.time),
          cpu: p.cpu_avg,
          mem: p.mem_avg,
          disk: p.disk_avg,
          rx: p.net_rx_avg,
          tx: p.net_tx_avg,
        }))

  return capPoints(
    points
      .filter((p) => [p.t, p.cpu, p.mem, p.disk, p.rx, p.tx].every(Number.isFinite))
      .sort((a, b) => a.t - b.t),
  )
}

/**
 * Shrinks an array longer than `max` by picking evenly spaced points; the LAST point is always kept (the
 * newest value must not disappear). Keeps the order and does not mutate the input.
 */
export function capPoints(points: readonly ChartPoint[], max: number = MAX_POINTS): ChartPoint[] {
  if (points.length <= max) return [...points]

  const stride = Math.ceil(points.length / max)
  const picked = points.filter((_, i) => i % stride === 0)
  const last = points[points.length - 1]
  if (last !== undefined && picked[picked.length - 1] !== last) picked.push(last)
  return picked
}
