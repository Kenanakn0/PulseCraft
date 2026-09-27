import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { AppLayout } from './components/AppLayout'
import { RequireAuth } from './components/RequireAuth'
import { AlertsPage } from './pages/AlertsPage'
import { DashboardPage } from './pages/DashboardPage'
import { RulesPage } from './pages/RulesPage'
import { LoginPage } from './pages/LoginPage'

// The detail page (and Chart.js with it) is loaded on first visit only, keeping login and the server list small.
const NodeDetailPage = lazy(() => import('./pages/NodeDetailPage'))

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="alerts" element={<AlertsPage />} />
          <Route path="alert-rules" element={<RulesPage />} />
          <Route
            path="nodes/:id"
            element={
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
