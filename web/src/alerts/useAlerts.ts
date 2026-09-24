import { useContext } from 'react'
import { AlertsContext, type AlertsContextValue } from './alertsContext'

export function useAlerts(): AlertsContextValue {
  const value = useContext(AlertsContext)
  if (value === null) throw new Error('useAlerts yalnızca <AlertsProvider> içinde kullanılabilir')
  return value
}
