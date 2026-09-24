import { createContext } from 'react'
import type { ConnectionStatus } from './client'
import type { RealtimeEvent } from './events'

export type RealtimeListener = (event: RealtimeEvent) => void

export interface RealtimeContextValue {
  status: ConnectionStatus
  /**
   * Yeniden bağlanma sayısı (ilk bağlantı hariç). Bir veri kaynağı bunu effect bağımlılığına koyarak
   * "kopma sırasında kaçan olaylar olabilir, REST'ten yeniden senkronla" kuralını uygular.
   */
  epoch: number
  /** Olaylara abone olur; abonelikten çıkan fonksiyon döner (C#'ta `event +=` / `-=`). */
  subscribe: (listener: RealtimeListener) => () => void
}

// Varsayılan değer = "canlı akış yok": Provider'ın dışında (ör. tek başına hook testlerinde) her şey
// yalnızca REST ile çalışır, hata fırlatılmaz.
export const RealtimeContext = createContext<RealtimeContextValue>({
  status: 'closed',
  epoch: 0,
  subscribe: () => () => undefined,
})
