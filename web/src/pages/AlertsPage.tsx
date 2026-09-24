import { useSearchParams } from 'react-router'
import { alertsForTab, countByStatus } from '../alerts/state'
import { useAlerts } from '../alerts/useAlerts'
import type { AlertStatus } from '../api/types'
import { AlertCard } from '../components/AlertCard'

const TABS: { id: AlertStatus; label: string; empty: string }[] = [
  { id: 'open', label: 'Açık', empty: 'Açık alarm yok.' },
  { id: 'acknowledged', label: 'İncelenen', empty: 'İncelenen alarm yok.' },
  { id: 'resolved', label: 'Çözülen', empty: 'Çözülen alarm yok.' },
]

/** Sunucunun her durum için döndürdüğü en çok kayıt (bkz. GET /api/v1/alerts). */
const SERVER_LIMIT = 200

const parseTab = (value: string | null): AlertStatus => TABS.find((t) => t.id === value)?.id ?? 'open'

/** Ortak alarm panosu: tüm kullanıcılar aynı listeyi görür; bir kullanıcı incelemeye alınca hepsinde anında güncellenir. */
export function AlertsPage() {
  const { state, acknowledge, reload } = useAlerts()

  // Seçili sekme adreste (?tab=): yenilenince/bağlantı paylaşılınca aynı görünüm gelir (bkz. NodeDetailPage).
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = parseTab(searchParams.get('tab'))

  const alerts = state.status === 'ready' ? state.alerts : []
  const counts = countByStatus(alerts)
  const visible = alertsForTab(alerts, tab)
  const current = TABS.find((t) => t.id === tab) ?? TABS[0]!

  return (
    <section>
      <div className="page-head">
        <h1>Alarmlar</h1>
      </div>

      {state.status === 'loading' && (
        <p className="page-message" role="status">
          Alarmlar yükleniyor…
        </p>
      )}

      {state.status === 'error' && (
        <div className="card error-card" role="alert">
          <p>{state.message}</p>
          <button type="button" onClick={reload}>
            Yeniden dene
          </button>
        </div>
      )}

      {state.status === 'ready' && (
        <>
          {state.refreshError !== null && (
            <p className="notice" role="status">
              {state.refreshError} Son bilinen veriler gösteriliyor.
            </p>
          )}

          <div className="tabs" role="tablist" aria-label="Alarm durumu">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={t.id === tab}
                aria-controls="alerts-panel"
                className={t.id === tab ? 'active' : undefined}
                onClick={() => setSearchParams({ tab: t.id }, { replace: true })}
              >
                {t.label} <span className="tab-count">{counts[t.id]}</span>
              </button>
            ))}
          </div>

          <div id="alerts-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
            {visible.length === 0 ? (
              <p className="card">{current.empty}</p>
            ) : (
              <ul className="alert-list">
                {visible.map((alert) => (
                  <AlertCard key={alert.id} alert={alert} onAcknowledge={acknowledge} />
                ))}
              </ul>
            )}
            {counts[tab] >= SERVER_LIMIT && (
              <p className="muted">Bu sekmede en yeni {SERVER_LIMIT} kayıt gösteriliyor.</p>
            )}
          </div>
        </>
      )}
    </section>
  )
}
