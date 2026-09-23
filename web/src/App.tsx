import { Navigate, Route, Routes } from 'react-router'
import { AppLayout } from './components/AppLayout'
import { RequireAuth } from './components/RequireAuth'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'

// Rota tablosu (C#'ta endpoint/controller yönlendirmesine benzer, ama TARAYICIDA çalışır:
// sayfa yenilenmeden adres çubuğu ve ekran değişir). İç içe rotalar: RequireAuth giriş
// kontrolünü, AppLayout çerçeveyi yapar; sayfa kendi <Outlet /> boşluğuna çizilir.
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
