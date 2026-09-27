const decimal = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 })

/** Network rate in readable units: 1500 → "1,5 KB/s" (1 KB = 1024 bytes). */
export function formatBytesRate(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) return `${decimal.format(bytesPerSecond)} B/s`
  if (bytesPerSecond < 1024 * 1024) return `${decimal.format(bytesPerSecond / 1024)} KB/s`
  if (bytesPerSecond < 1024 ** 3) return `${decimal.format(bytesPerSecond / 1024 ** 2)} MB/s`
  return `${decimal.format(bytesPerSecond / 1024 ** 3)} GB/s`
}

export type GaugeLevel = 'ok' | 'warn' | 'crit'

/** Gauge colour thresholds: < 70 % normal, < 90 % warning, ≥ 90 % critical. */
export function gaugeLevel(percent: number): GaugeLevel {
  if (percent >= 90) return 'crit'
  if (percent >= 70) return 'warn'
  return 'ok'
}

/** Clamps to 0-100 so an out-of-range value cannot break the drawing. */
export function clampPercent(percent: number): number {
  return Math.min(100, Math.max(0, percent))
}
