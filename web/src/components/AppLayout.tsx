import { NavLink, Outlet } from 'react-router'
import { AlertsProvider } from '../alerts/AlertsProvider'
import { useAuth } from '../auth/useAuth'
import { RealtimeProvider } from '../realtime/RealtimeProvider'
import { AlertsNavLink } from './AlertsNavLink'
import { LiveIndicator } from './LiveIndicator'

// Giriş yapılmış tüm sayfaların ortak çerçevesi (üst çubuk + sayfa içeriği).
// Sağlayıcılar burada: bu çerçeve yalnızca giriş yapılmışken çizilir (RequireAuth), yani canlı bağlantı
// ve alarm listesi oturumla birlikte açılır, çıkışta/oturum bitince kapanır. Sıra dıştan içe:
// canlı bağlantı → alarmlar (olayları bağlantıdan alır) → sayfa.
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
            </nav>
            <span className="spacer" />
            <LiveIndicator />
            <span className="muted" data-testid="current-user">
              {user?.display_name}
            </span>
            {/* void: dönen Promise'i bilerek beklemiyoruz (olay yöneticisi async olamaz) */}
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
