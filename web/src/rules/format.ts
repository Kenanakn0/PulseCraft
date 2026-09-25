import { metricLabel } from '../alerts/format'
import type { AlertRule } from '../api/types'

const thresholdFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 })

/** "CPU > 90 %" ya da süreliyse "CPU > 90 % (60 sn boyunca)". */
export function formatCondition(rule: Pick<AlertRule, 'metric' | 'operator' | 'threshold' | 'duration_seconds'>): string {
  const base = `${metricLabel(rule.metric)} ${rule.operator} ${thresholdFormat.format(rule.threshold)} %`
  return rule.duration_seconds > 0 ? `${base} (${rule.duration_seconds} sn boyunca)` : base
}
