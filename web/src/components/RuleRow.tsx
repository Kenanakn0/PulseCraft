import { useState } from 'react'
import { SEVERITY_LABELS } from '../alerts/format'
import { rulesApi } from '../api/rules'
import { ApiError } from '../api/http'
import type { AlertRule } from '../api/types'
import { formatCondition } from '../rules/format'

interface RuleRowProps {
  rule: AlertRule
  /** Kuralın uygulandığı sunucunun adı; `rule.node_id` null'sa (tüm sunucular) kullanılmaz. */
  nodeName: string | null
  onChanged: () => void
}

/** Alarm kuralları tablosundaki tek satır: etkinleştir/devre dışı bırak ve onaylı silme. */
export function RuleRow({ rule, nodeName, onChanged }: RuleRowProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  async function toggle() {
    setPending(true)
    setError(null)
    try {
      await rulesApi.update(rule.id, {
        name: rule.name,
        node_id: rule.node_id,
        metric: rule.metric,
        operator: rule.operator,
        threshold: rule.threshold,
        duration_seconds: rule.duration_seconds,
        severity: rule.severity,
        enabled: !rule.enabled,
      })
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError && err.status !== 0 ? err.message : 'Sunucuya ulaşılamadı.')
    } finally {
      setPending(false)
    }
  }

  async function confirmDelete() {
    setPending(true)
    setError(null)
    try {
      await rulesApi.remove(rule.id)
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError && err.status !== 0 ? err.message : 'Sunucuya ulaşılamadı.')
      setPending(false)
      setConfirmingDelete(false)
    }
  }

  return (
    <tr data-testid="rule-row" data-rule-id={rule.id}>
      <td>{rule.name}</td>
      <td>{formatCondition(rule)}</td>
      <td>{rule.node_id === null ? 'Tüm sunucular' : (nodeName ?? 'Bilinmeyen sunucu')}</td>
      <td>{SEVERITY_LABELS[rule.severity]}</td>
      <td>
        <span className={`badge ${rule.enabled ? 'online' : 'offline'}`}>{rule.enabled ? 'Etkin' : 'Kapalı'}</span>
      </td>
      <td className="rule-actions">
        {confirmingDelete ? (
          <span className="confirm-delete">
            Emin misiniz? Geçmiş alarmlar da silinir.
            <button type="button" className="danger" onClick={() => void confirmDelete()} disabled={pending}>
              {pending ? 'Siliniyor…' : 'Evet, sil'}
            </button>
            <button type="button" onClick={() => setConfirmingDelete(false)} disabled={pending}>
              Vazgeç
            </button>
          </span>
        ) : (
          <>
            <button type="button" onClick={() => void toggle()} disabled={pending}>
              {rule.enabled ? 'Devre dışı bırak' : 'Etkinleştir'}
            </button>
            <button type="button" onClick={() => setConfirmingDelete(true)} disabled={pending}>
              Sil
            </button>
          </>
        )}
        {error !== null && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </td>
    </tr>
  )
}
