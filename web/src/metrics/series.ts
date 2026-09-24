import type { MetricsRangeResponse } from '../api/types'

/** Grafiklerin kullandığı, ham ve özet verinin ORTAK biçimi. */
export interface ChartPoint {
  /** Zaman (ms, epoch). */
  t: number
  cpu: number
  mem: number
  disk: number
  /** Ağdan alınan / gönderilen (byte/sn). */
  rx: number
  tx: number
}

/**
 * Bellekte ve çizimde tutulacak en fazla nokta. Seçili pencere zaten sınırlıdır (15 dk … 24 sa) ve
 * çizimde Chart.js decimation (LTTB) ile ayrıca seyreltilir; bu tavan, beklenmedik büyüklükte bir
 * yanıtın tarayıcıyı yormasına karşı son güvencedir.
 */
export const MAX_POINTS = 2000

/**
 * Sunucu yanıtını ortak noktalara çevirir: ham ve özet veriyi aynı biçime getirir, geçersiz
 * (sayı olmayan) satırları atar, zamana göre sıralar. `resolution` ayırt edici alan olduğu için
 * TypeScript her dalda doğru nokta tipini bilir.
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
 * `max`'ı aşan diziyi, eşit aralıklı noktalar seçerek küçültür; SON nokta her zaman korunur
 * (en güncel değer kaybolmasın). Sıralı diziyi bozmaz, girdiyi değiştirmez.
 */
export function capPoints(points: readonly ChartPoint[], max: number = MAX_POINTS): ChartPoint[] {
  if (points.length <= max) return [...points]

  const stride = Math.ceil(points.length / max)
  const picked = points.filter((_, i) => i % stride === 0)
  const last = points[points.length - 1]
  if (last !== undefined && picked[picked.length - 1] !== last) picked.push(last)
  return picked
}
