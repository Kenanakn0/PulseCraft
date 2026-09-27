import type { MetricEvent } from '../realtime/events'
import { capPoints, MAX_POINTS, type ChartPoint } from './series'

/**
 * An event more than this many ms past the end of the REST window is ignored (the agent's clock may be
 * far ahead): one broken clock must not shift the whole chart.
 */
export const MAX_AHEAD_MS = 2 * 60_000

export function eventToPoint(ev: MetricEvent): ChartPoint {
  return {
    t: Date.parse(ev.time),
    cpu: ev.cpu_percent,
    mem: ev.mem_percent,
    disk: ev.disk_percent,
    rx: ev.net_rx_bps,
    tx: ev.net_tx_bps,
  }
}

/**
 * Appends to the live buffer. Points older than or equal to the last one are ignored (idempotent); the
 * buffer is bounded.
 */
export function appendLive(live: readonly ChartPoint[], point: ChartPoint): readonly ChartPoint[] {
  const last = live[live.length - 1]
  if (last !== undefined && point.t <= last.t) return live
  return [...live, point].slice(-MAX_POINTS)
}

export interface LiveChart {
  points: ChartPoint[]
  from: number
  to: number
}

/**
 * Appends live points to the REST history and SLIDES the window: the end moves to the newest point, the
 * start moves by the same amount (constant width) and points that fall out are dropped, so the point count
 * stays bounded. Live points not newer than the last REST point are already included and skipped. Does not
 * mutate its inputs.
 */
export function mergeLivePoints(
  base: readonly ChartPoint[],
  from: number,
  to: number,
  live: readonly ChartPoint[],
): LiveChart {
  const lastBase = base[base.length - 1]?.t ?? Number.NEGATIVE_INFINITY
  const extra = live.filter((p) => p.t > lastBase && p.t <= to + MAX_AHEAD_MS)
  const newest = extra[extra.length - 1]
  if (newest === undefined) return { points: [...base], from, to }

  const newTo = Math.max(to, newest.t)
  const newFrom = from + (newTo - to)
  const points = capPoints([...base, ...extra].filter((p) => p.t >= newFrom))
  return { points, from: newFrom, to: newTo }
}
