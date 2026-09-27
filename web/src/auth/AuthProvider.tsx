import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { authApi } from '../api/auth'
import { isAbortError, onUnauthorized } from '../api/http'
import { AuthContext, type AuthContextValue, type AuthState } from './authContext'

const UNAUTHENTICATED: AuthState = { status: 'unauthenticated', user: null, sessionExpired: false }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null, sessionExpired: false })

  // In development <StrictMode> runs every effect twice (set up → clean up → set up). The first run's
  // request is aborted here, so two requests may go out but the state is written only once.
  useEffect(() => {
    const controller = new AbortController()

    authApi.me(controller.signal).then(
      (me) => setState({ status: 'authenticated', user: me.user, sessionExpired: false }),
      (err: unknown) => {
        if (isAbortError(err)) return // unmounted: the result no longer matters
        // 401 (no session) is expected; on a network error the login page is shown as well.
        setState(UNAUTHENTICATED)
      },
    )

    return () => controller.abort()
  }, [])

  // A 401 anywhere else in the app (token expired, or logout in another tab) returns the user to login.
  useEffect(
    () =>
      onUnauthorized(() =>
        setState((current) =>
          current.status === 'authenticated' ? { ...UNAUTHENTICATED, sessionExpired: true } : current,
        ),
      ),
    [],
  )

  // Stable identity: it is a dependency of the memoized context value below; a new function on every
  // render would re-render every consumer.
  const login = useCallback(async (email: string, password: string) => {
    const response = await authApi.login(email, password)
    setState({ status: 'authenticated', user: response.user, sessionExpired: false })
  }, [])

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } catch {
      // Local state is cleared even if the server is unreachable (best effort). The server-side token may
      // then stay valid until it expires; a known limitation.
    }
    setState(UNAUTHENTICATED)
  }, [])

  const value = useMemo<AuthContextValue>(() => ({ ...state, login, logout }), [state, login, logout])

  return <AuthContext value={value}>{children}</AuthContext>
}
