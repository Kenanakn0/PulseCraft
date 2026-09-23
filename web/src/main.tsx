import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App'
import { AuthProvider } from './auth/AuthProvider'
import './index.css'

// Uygulamanın giriş noktası (C#'taki Program.cs). Sarmalama sırası, C#'taki middleware/DI
// kaydı gibi, dıştan içe doğru: yönlendirici → oturum bilgisi → uygulama.
const container = document.getElementById('root')
if (container === null) throw new Error('#root elementi bulunamadı')

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
