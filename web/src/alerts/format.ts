import type { AlertRow, AlertSeverity } from '../api/types'
import { formatPercent } from '../nodes/format'

const METRIC_LABELS: Record<string, string> = { cpu_percent: 'CPU', mem_percent: 'RAM', disk_percent: 'Disk' }

export const SEVERITY_LABELS: Record<AlertSeverity, string> = { critical: 'Kritik', warning: 'Uyarı', info: 'Bilgi' }

export const metricLabel = (metric: string) => METRIC_LABELS[metric] ?? metric

const thresholdFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 })

/** "CPU 93,2 % (eşik > 90 %)" */
export function formatTrigger(alert: Pick<AlertRow, 'metric' | 'trigger_value' | 'operator' | 'threshold'>): string {
  return `${metricLabel(alert.metric)} ${formatPercent(alert.trigger_value)} (eşik ${alert.operator} ${thresholdFormat.format(alert.threshold)} %)`
}

/**
 * Absolute timestamp ("24.09.2026 21:14:05"). Not "3 min ago": relative time would depend on the browser clock.
 */
export function formatDateTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone,
  }).format(new Date(iso))
}

/** Duration between two SERVER timestamps: "45 sn", "12 dk 5 sn", "2 sa 3 dk", "1 gün 4 sa". */
export function formatDuration(fromIso: string, toIso: string): string {
  const seconds = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 1000))
  if (seconds < 60) return `${seconds} sn`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return seconds % 60 === 0 ? `${minutes} dk` : `${minutes} dk ${seconds % 60} sn`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 === 0 ? `${hours} sa` : `${hours} sa ${minutes % 60} dk`
  const days = Math.floor(hours / 24)
  return hours % 24 === 0 ? `${days} gün` : `${days} gün ${hours % 24} sa`
}
