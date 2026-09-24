import { NavLink } from 'react-router'
import { countByStatus } from '../alerts/state'
import { useAlerts } from '../alerts/useAlerts'

/** Üst çubuktaki "Alarmlar" bağlantısı; açık (henüz kimsenin incelemeye almadığı) alarm sayısını rozet olarak gösterir. */
export function AlertsNavLink() {
  const { state } = useAlerts()
  const open = state.status === 'ready' ? countByStatus(state.alerts).open : 0

  return (
    <NavLink to="/alerts">
      Alarmlar
      {open > 0 && (
        <span className="nav-badge" data-testid="open-alerts-badge" aria-label={`${open} açık alarm`}>
          {open}
        </span>
      )}
    </NavLink>
  )
}
