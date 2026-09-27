import { createContext } from 'react'
import type { AlertRow } from '../api/types'

export type AckResult =
  | { kind: 'ok' }
  /** The alert is no longer `open` (someone was faster, or it resolved); the list is refreshed. */
  | { kind: 'conflict'; message: string }
  | { kind: 'error'; message: string }

export type AlertsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      /** Alerts in all statuses (REST snapshot merged with live events). */
      alerts: AlertRow[]
      /** A refresh after the first successful load failed; the last known data stays. */
      refreshError: string | null
    }

export interface AlertsContextValue {
  state: AlertsState
  acknowledge: (id: number) => Promise<AckResult>
  /** "Try again": starts over from the loading state. */
  reload: () => void
}

// Default null: useAlerts outside the provider throws a clear error (see useAuth).
export const AlertsContext = createContext<AlertsContextValue | null>(null)
