import { useAuth } from '../auth/useAuth'

// Geçici sayfa: giriş akışını doğrulamak için. Sunucu listesi 4.1b adımında gelecek.
export function DashboardPage() {
  const { user } = useAuth()

  return (
    <section>
      <h1>Sunucular</h1>
      <div className="card">
        <p>
          Merhaba, <strong>{user?.display_name}</strong> ({user?.email}).
        </p>
        <p className="muted">Sunucu listesi bir sonraki adımda (4.1b) burada görünecek.</p>
      </div>
    </section>
  )
}
