import { useContext, useEffect, useRef } from 'react'
import { RealtimeContext, type RealtimeListener } from './realtimeContext'

export function useRealtime() {
  return useContext(RealtimeContext)
}

/**
 * Subscribes to live events and unsubscribes on unmount. `handler` may be a new function on every render:
 * the latest one is kept in a ref and the subscription is not recreated (see usePolledResource).
 */
export function useRealtimeEvents(handler: RealtimeListener): void {
  const { subscribe } = useRealtime()

  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  })

  useEffect(() => subscribe((event) => handlerRef.current(event)), [subscribe])
}
