import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { AppLayout } from './components/AppLayout'
import { RequireAuth } from './components/RequireAuth'
import { AlertsPage } from './pages/AlertsPage'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'

// LAZY YÜKLEME: detay sayfası (ve onunla Chart.js kütüphanesi) yalnızca ilk kez ziyaret edilince
// indirilir; giriş ve sunucu listesi küçük kalır. C#'ta Lazy<T> ile ya da bir derlemeyi
// ihtiyaç anında yüklemekle aynı fikir. `import()` bir Promise döndürür, Vite bunu ayrı bir dosyaya böler.
const NodeDetailPage = lazy(() => import('./pages/NodeDetailPage'))

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
          <Route path="alerts" element={<AlertsPage />} />
          <Route
            path="nodes/:id"
            element={
              // Suspense: lazy bileşen inene kadar gösterilecek yedek içerik (yükleniyor ekranı).
              <Suspense
                fallback={
                  <p className="page-message" role="status">
                    Sayfa yükleniyor…
                  </p>
                }
              >
                <NodeDetailPage />
              </Suspense>
            }
          />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
