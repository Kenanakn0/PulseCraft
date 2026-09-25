import type { RulePayload } from '../api/rules'
import type { AlertSeverity } from '../api/types'

/** Sunucunun kabul ettiği metrikler, mockup'taki sırayla (docs/decisions.md: yalnızca CPU/RAM/Disk). */
export const METRIC_OPTIONS = ['cpu_percent', 'mem_percent', 'disk_percent'] as const
export const OPERATOR_OPTIONS = ['>', '>=', '<', '<='] as const
export const SEVERITY_OPTIONS: AlertSeverity[] = ['critical', 'warning', 'info']

/**
 * Form alanları METİN olarak tutulur (kontrollü `<input>`ların doğal tipi): kullanıcı "9" yazarken
 * "90" olana kadar geçici olarak geçersiz bir sayı görünmemeli; doğrulama yalnızca gönderirken çalışır.
 */
export interface RuleFormValues {
  name: string
  /** '' = tüm sunucular. */
  nodeId: string
  metric: string
  operator: string
  threshold: string
  durationSeconds: string
  severity: AlertSeverity
}

export const emptyRuleForm: RuleFormValues = {
  name: '',
  nodeId: '',
  metric: 'cpu_percent',
  operator: '>',
  threshold: '',
  durationSeconds: '0',
  severity: 'warning',
}

/** Girdiyi doğrular; sorun varsa Türkçe hata mesajı, yoksa `null` döner. */
export function validateRuleForm(values: RuleFormValues): string | null {
  if (values.name.trim() === '') return 'Kural adı zorunlu.'

  const threshold = Number(values.threshold)
  if (values.threshold.trim() === '' || !Number.isFinite(threshold)) return 'Eşik geçerli bir sayı olmalı.'

  const duration = Number(values.durationSeconds)
  if (values.durationSeconds.trim() === '' || !Number.isInteger(duration) || duration < 0) {
    return 'Süre, 0 veya daha büyük bir tam sayı (saniye) olmalı.'
  }

  return null
}

/** Doğrulanmış form değerlerini sunucuya gönderilecek gövdeye çevirir. */
export function toRulePayload(values: RuleFormValues, enabled = true): RulePayload {
  return {
    name: values.name.trim(),
    node_id: values.nodeId === '' ? null : values.nodeId,
    metric: values.metric,
    operator: values.operator,
    threshold: Number(values.threshold),
    duration_seconds: Number(values.durationSeconds),
    severity: values.severity,
    enabled,
  }
}
