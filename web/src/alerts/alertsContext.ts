import { createContext } from 'react'
import type { AlertRow } from '../api/types'

/** "İncelemeye aldım" işleminin sonucu. */
export type AckResult =
  | { kind: 'ok' }
  /** Alarm artık `open` değil (başkası önce davrandı ya da çözüldü); liste yenilenir. */
  | { kind: 'conflict'; message: string }
  | { kind: 'error'; message: string }

export type AlertsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      /** Tüm durumlardaki alarmlar (REST anlık görüntüsü + canlı olaylar, birleştirilmiş). */
      alerts: AlertRow[]
      /** Liste bir kez yüklendikten sonraki bir yenilemenin başarısız olduğunu söyler; son bilinen veri kalır. */
      refreshError: string | null
    }

export interface AlertsContextValue {
  state: AlertsState
  acknowledge: (id: number) => Promise<AckResult>
  /** "Yeniden dene": yükleme durumuna dönerek baştan yükler. */
  reload: () => void
}

// Varsayılan null: provider olmadan kullanılırsa useAlerts anlaşılır bir hata verir (bkz. useAuth).
export const AlertsContext = createContext<AlertsContextValue | null>(null)
