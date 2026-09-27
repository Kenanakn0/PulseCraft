import { apiFetch } from './http'
import type { LoginResponse, MeResponse } from './types'

// All three use silent401: here 401 means "no session / wrong password" and is handled by the caller, so
// the global "session ended" notice is not triggered.
export const authApi = {
  me: (signal?: AbortSignal) => apiFetch<MeResponse>('/api/v1/auth/me', { signal, silent401: true }),

  login: (email: string, password: string) =>
    apiFetch<LoginResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: { email, password },
      silent401: true,
    }),

  /** NOT silent: a 401 triggers the global "session ended" notice (used after WebSocket disconnects). */
  probe: (signal?: AbortSignal) => apiFetch<MeResponse>('/api/v1/auth/me', { signal }),

  logout: () => apiFetch<void>('/api/v1/auth/logout', { method: 'POST', silent401: true }),
}
