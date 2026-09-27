import { useMemo } from 'react'
import { rulesApi } from '../api/rules'
import type { AlertRule } from '../api/types'
import { usePolledResource } from '../nodes/usePolledResource'

/**
 * Rules change rarely and, unlike alerts, have no WS events (only "deleted"; see AlertsProvider), so
 * modest polling is enough; our own actions call `reload()` right away.
 */
export const RULES_POLL_MS = 30_000

export type RulesState =
  | { status: 'loading' }
  | { status: 'ready'; rules: AlertRule[]; refreshError: string | null }
  | { status: 'error'; message: string }

export function useRules(pollMs: number = RULES_POLL_MS) {
  const { state, reload } = usePolledResource(rulesApi.list, pollMs, 'Alarm kuralları')

  const rulesState = useMemo<RulesState>(
    () => (state.status === 'ready' ? { status: 'ready', rules: state.data, refreshError: state.refreshError } : state),
    [state],
  )

  return { state: rulesState, reload }
}
