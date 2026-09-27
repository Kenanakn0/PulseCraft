import { NavLink, Outlet } from 'react-router'
import { AlertsProvider } from '../alerts/AlertsProvider'
import { useAuth } from '../auth/useAuth'
import { RealtimeProvider } from '../realtime/RealtimeProvider'
import { AlertsNavLink } from './AlertsNavLink'
import { LiveIndicator } from './LiveIndicator'

// Layout of all signed-in pages. The providers live here: the layout only renders with a session
// (RequireAuth), so the live connection and the alert list open and close with the session. Outer to
// inner: live connection → alerts (fed by the connection) → page.
export function AppLayout() {
  const { user, logout } = useAuth()

  return (
    <RealtimeProvider>
      <AlertsProvider>
        <div className="app">
          <header className="app-header">
            <strong className="brand">PulseCraft</strong>
            <nav className="main-nav" aria-label="Ana menü">
              <NavLink to="/" end>
                Sunucular
              </NavLink>
              <AlertsNavLink />
              <NavLink to="/alert-rules">Kurallar</NavLink>
            </nav>
            <span className="spacer" />
            <LiveIndicator />
            <span className="muted" data-testid="current-user">
              {user?.display_name}
            </span>
            {/* void: the promise is deliberately not awaited (event handlers cannot be async) */}
            <button type="button" onClick={() => void logout()}>
              Çıkış
            </button>
          </header>
          <main className="app-content">
            <Outlet />
          </main>
        </div>
      </AlertsProvider>
    </RealtimeProvider>
  )
}
