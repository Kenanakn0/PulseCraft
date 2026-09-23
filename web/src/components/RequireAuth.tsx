import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from '../auth/useAuth'

// Rota koruyucusu: C#'taki [Authorize] gibi. Giriş yoksa /login'e yönlendirir (ve nereden
// geldiğini hatırlatır ki girişten sonra oraya dönülebilsin); varsa iç içe rotayı çizer.
// <Outlet />, C#/Razor'daki @Body / RenderBody karşılığıdır: alt rotanın çizileceği boşluk.
export function RequireAuth() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <p className="page-message" role="status">
        Yükleniyor…
      </p>
    )
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }

  return <Outlet />
}
