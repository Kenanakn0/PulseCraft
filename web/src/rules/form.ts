import type { RulePayload } from '../api/rules'
import type { AlertSeverity } from '../api/types'

/**
 * Metrics accepted by the server, in the mockup's order (CPU/RAM/Disk only; see docs/decisions.md "Alerting").
 */
export const METRIC_OPTIONS = ['cpu_percent', 'mem_percent', 'disk_percent'] as const
export const OPERATOR_OPTIONS = ['>', '>=', '<', '<='] as const
export const SEVERITY_OPTIONS: AlertSeverity[] = ['critical', 'warning', 'info']

/**
 * Form fields are kept as TEXT (the natural type of controlled inputs): while typing "9" on the way to
 * "90" no temporary invalid number should appear; validation runs only on submit.
 */
export interface RuleFormValues {
  name: string
  /** '' = all servers. */
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

/** Validates the input; returns a Turkish error message or `null`. */
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

/** Turns validated form values into the request body. */
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
