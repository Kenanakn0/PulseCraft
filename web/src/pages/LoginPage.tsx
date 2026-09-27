import { useState, type SubmitEvent } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { loginErrorMessage, safeRedirectPath } from './loginError'

export function LoginPage() {
  const { status, sessionExpired, login } = useAuth()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Already signed in (or just signed in): redirect without rendering the form. A successful login changes
  // AuthProvider's state, this component re-renders and ends up here, so no navigate() call is needed.
  if (status === 'authenticated') {
    return <Navigate to={safeRedirectPath(location.state)} replace />
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault() // prevent the browser's full-page form submission
    setError(null)

    const trimmedEmail = email.trim()
    if (trimmedEmail === '' || password === '') {
      setError('E-posta ve parola girin.')
      return
    }

    setSubmitting(true)
    try {
      await login(trimmedEmail, password)
    } catch (err) {
      setError(loginErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <form className="card login-card" onSubmit={handleSubmit} noValidate>
        <h1>PulseCraft</h1>
        <p className="muted">Sunucu izleme paneline giriş yapın</p>

        {sessionExpired && (
          <p className="notice" role="status">
            Oturumunuzun süresi doldu. Lütfen yeniden giriş yapın.
          </p>
        )}

        <label htmlFor="email">E-posta</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
          autoFocus
        />

        <label htmlFor="password">Parola</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
        />

        {error !== null && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? 'Giriş yapılıyor…' : 'Giriş yap'}
        </button>
      </form>
    </main>
  )
}
