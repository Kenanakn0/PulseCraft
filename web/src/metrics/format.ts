const decimal = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 })

/** Ağ hızını okunur birime çevirir: 1500 → "1,5 KB/s". (1 KB = 1024 bayt.) */
export function formatBytesRate(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) return `${decimal.format(bytesPerSecond)} B/s`
  if (bytesPerSecond < 1024 * 1024) return `${decimal.format(bytesPerSecond / 1024)} KB/s`
  if (bytesPerSecond < 1024 ** 3) return `${decimal.format(bytesPerSecond / 1024 ** 2)} MB/s`
  return `${decimal.format(bytesPerSecond / 1024 ** 3)} GB/s`
}

export type GaugeLevel = 'ok' | 'warn' | 'crit'

/** Göstergenin rengini belirleyen eşikler: < %70 normal, < %90 uyarı, ≥ %90 kritik. */
export function gaugeLevel(percent: number): GaugeLevel {
  if (percent >= 90) return 'crit'
  if (percent >= 70) return 'warn'
  return 'ok'
}

/** Göstergeyi 0-100 aralığına sıkıştırır (yüzde dışı bir değer çizimi bozmasın). */
export function clampPercent(percent: number): number {
  return Math.min(100, Math.max(0, percent))
}
