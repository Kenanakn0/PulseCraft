import { useState } from 'react'
import { Link } from 'react-router'
import type { AckResult } from '../alerts/alertsContext'
import { formatDateTime, formatDuration, formatTrigger, SEVERITY_LABELS } from '../alerts/format'
import type { AlertRow } from '../api/types'

interface AlertCardProps {
  alert: AlertRow
  onAcknowledge: (id: number) => Promise<AckResult>
}

/**
 * A single alert: an acknowledge button while open, who took it while acknowledged, the duration once resolved.
 */
export function AlertCard({ alert, onAcknowledge }: AlertCardProps) {
  // On success the card moves to another tab and unmounts, so state is only touched on failure.
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function acknowledge() {
    setPending(true)
    setMessage(null)
    const result = await onAcknowledge(alert.id)
    if (result.kind !== 'ok') setMessage(result.message)
    setPending(false)
  }

  const acknowledger = alert.acknowledged_by ?? 'Bir kullanıcı'

  return (
    <li className={`card alert-card sev-${alert.severity}`} data-testid="alert-card" data-status={alert.status}>
      <div className="alert-head">
        <span className="sev-badge">{SEVERITY_LABELS[alert.severity]}</span>
        <strong>{alert.rule_name}</strong>
      </div>

      <p className="alert-detail">
        <Link to={`/nodes/${encodeURIComponent(alert.node_id)}`}>{alert.node_name}</Link> · {formatTrigger(alert)}
      </p>

      <p className="muted">Başladı: {formatDateTime(alert.triggered_at)}</p>

      {alert.status === 'open' && (
        <div className="alert-actions">
          <button type="button" className="primary" onClick={() => void acknowledge()} disabled={pending} aria-busy={pending}>
            {pending ? 'Alınıyor…' : 'İncelemeye aldım'}
          </button>
        </div>
      )}

      {alert.status === 'acknowledged' && (
        <p className="alert-state">
          <strong>{acknowledger}</strong> inceliyor
          {alert.acknowledged_at !== null && <> · {formatDateTime(alert.acknowledged_at)}</>}
        </p>
      )}

      {alert.status === 'resolved' && alert.resolved_at !== null && (
        <p className="alert-state">
          Çözüldü: {formatDateTime(alert.resolved_at)} · Süre: {formatDuration(alert.triggered_at, alert.resolved_at)}
          {alert.acknowledged_by !== null && <> · {alert.acknowledged_by} incelemişti</>}
        </p>
      )}

      {message !== null && (
        <p className="alert-error" role="alert">
          {message}
        </p>
      )}
    </li>
  )
}
