import { createContext } from 'react'
import type { User } from '../api/types'

export type AuthStatus =
  /** The page just loaded and GET /auth/me has not answered yet. */
  | 'loading'
  | 'authenticated'
  | 'unauthenticated'

export interface AuthState {
  status: AuthStatus
  user: User | null
  /** True if the session ended without a logout (e.g. it expired): the login page explains why. */
  sessionExpired: boolean
}

export interface AuthContextValue extends AuthState {
  /** Throws ApiError on failure (401 wrong password, 429 too many attempts, 0 network error …). */
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

// Default null: useAuth outside the provider throws a clear error.
export const AuthContext = createContext<AuthContextValue | null>(null)
