import { useMemo } from 'react'
import { rulesApi } from '../api/rules'
import type { AlertRule } from '../api/types'
import { usePolledResource } from '../nodes/usePolledResource'

/**
 * Kurallar bu istemcinin dışındaki değişikliklerle de (başka kullanıcı ekleyip kapatabilir) sık
 * değişmez; alarmların aksine WS olayı da yok (yalnızca "silindi" olayı var, bkz. AlertsProvider).
 * Bu yüzden ölçülü bir yoklama yeterli — kendi işlemlerimizden sonra zaten anında `reload()` çağrılır.
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
