import type { MetricEvent } from '../realtime/events'
import { capPoints, MAX_POINTS, type ChartPoint } from './series'

/**
 * Bir olayın zamanı, REST penceresinin bitişinden bu kadar ms'den fazla ileride ise (agent saati çok
 * ileri olabilir) yok sayılır: tek bozuk saat tüm grafiği ileri kaydırmasın.
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

/** Canlı tamponuna nokta ekler. Sondakinden eski/aynı zamanlı nokta yok sayılır (idempotent); tampon sınırlıdır. */
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
 * REST'ten gelen geçmişin ÜSTÜNE canlı noktaları ekler ve pencereyi KAYDIRIR: bitiş yeni noktaya
 * ilerler, başlangıç aynı miktarda ilerler (pencere genişliği sabit) ve pencerenin dışına düşen eski
 * noktalar atılır. Böylece nokta sayısı seçili pencereyle sınırlı kalır. REST verisinin son
 * noktasından eski/aynı canlı noktalar zaten REST'te vardır ve atlanır. Girdileri DEĞİŞTİRMEZ.
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
