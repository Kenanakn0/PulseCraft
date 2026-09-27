import { createContext } from 'react'
import type { ConnectionStatus } from './client'
import type { RealtimeEvent } from './events'

export type RealtimeListener = (event: RealtimeEvent) => void

export interface RealtimeContextValue {
  status: ConnectionStatus
  /**
   * Number of reconnects (the first connection excluded). A data source puts it in an effect dependency to
   * resync from REST, since events may have been missed while disconnected.
   */
  epoch: number
  /** Subscribes to events; returns the unsubscribe function. */
  subscribe: (listener: RealtimeListener) => () => void
}

// Default = no live stream: outside the provider (e.g. standalone hook tests) everything works with REST
// only, without throwing.
export const RealtimeContext = createContext<RealtimeContextValue>({
  status: 'closed',
  epoch: 0,
  subscribe: () => () => undefined,
})
