import { Outlet } from 'react-router'
import { useAuth } from '../auth/useAuth'

// Giriş yapılmış tüm sayfaların ortak çerçevesi (üst çubuk + sayfa içeriği).
export function AppLayout() {
  const { user, logout } = useAuth()

  return (
    <div className="app">
      <header className="app-header">
        <strong className="brand">PulseCraft</strong>
        <span className="spacer" />
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
  )
}
