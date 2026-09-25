import { useState, type SubmitEvent } from 'react'
import { SEVERITY_LABELS, metricLabel } from '../alerts/format'
import { rulesApi } from '../api/rules'
import { ApiError } from '../api/http'
import type { NodeSummary } from '../api/types'
import {
  emptyRuleForm,
  METRIC_OPTIONS,
  OPERATOR_OPTIONS,
  SEVERITY_OPTIONS,
  toRulePayload,
  validateRuleForm,
  type RuleFormValues,
} from '../rules/form'

interface RuleFormProps {
  /** Node seçimi için; henüz yüklenmediyse boş liste (yalnızca "Tüm sunucular" görünür). */
  nodes: readonly NodeSummary[]
  onCreated: () => void
}

/** Yeni alarm kuralı ekleme formu (mockup: "Yeni kural" kartı). */
export function RuleForm({ nodes, onCreated }: RuleFormProps) {
  const [values, setValues] = useState<RuleFormValues>(emptyRuleForm)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof RuleFormValues>(key: K) => (value: RuleFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }))

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const validationError = validateRuleForm(values)
    if (validationError !== null) {
      setError(validationError)
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      await rulesApi.create(toRulePayload(values))
      setValues(emptyRuleForm)
      onCreated()
    } catch (err) {
      setError(err instanceof ApiError && err.status !== 0 ? err.message : 'Sunucuya ulaşılamadı.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="card rule-form" onSubmit={(e) => void handleSubmit(e)} noValidate aria-label="Yeni kural">
      <h2>Yeni kural</h2>

      <div className="rule-form-grid">
        <div>
          <label htmlFor="rule-name">Ad</label>
          <input
            id="rule-name"
            value={values.name}
            onChange={(e) => set('name')(e.target.value)}
            disabled={submitting}
            autoFocus
          />
        </div>

        <div>
          <label htmlFor="rule-node">Sunucu</label>
          <select id="rule-node" value={values.nodeId} onChange={(e) => set('nodeId')(e.target.value)} disabled={submitting}>
            <option value="">Tüm sunucular</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="rule-metric">Metrik</label>
          <select id="rule-metric" value={values.metric} onChange={(e) => set('metric')(e.target.value)} disabled={submitting}>
            {METRIC_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {metricLabel(m)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="rule-operator">Koşul</label>
          <select id="rule-operator" value={values.operator} onChange={(e) => set('operator')(e.target.value)} disabled={submitting}>
            {OPERATOR_OPTIONS.map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="rule-threshold">Eşik (%)</label>
          <input
            id="rule-threshold"
            inputMode="decimal"
            value={values.threshold}
            onChange={(e) => set('threshold')(e.target.value)}
            disabled={submitting}
          />
        </div>

        <div>
          <label htmlFor="rule-duration">Süre (sn)</label>
          <input
            id="rule-duration"
            inputMode="numeric"
            value={values.durationSeconds}
            onChange={(e) => set('durationSeconds')(e.target.value)}
            disabled={submitting}
          />
        </div>

        <div>
          <label htmlFor="rule-severity">Önem</label>
          <select
            id="rule-severity"
            value={values.severity}
            onChange={(e) => set('severity')(e.target.value as RuleFormValues['severity'])}
            disabled={submitting}
          >
            {SEVERITY_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {SEVERITY_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="primary" disabled={submitting}>
        {submitting ? 'Ekleniyor…' : 'Kural ekle'}
      </button>
    </form>
  )
}
