import { useContext, useEffect, useRef } from 'react'
import { RealtimeContext, type RealtimeListener } from './realtimeContext'

export function useRealtime() {
  return useContext(RealtimeContext)
}

/**
 * Canlı olaylara abone olur; bileşen kalkınca aboneliği bırakır. `handler` her çizimde farklı bir
 * fonksiyon olabilir: en günceli bir ref'te tutulur, abonelik yeniden kurulmaz (bkz. usePolledResource).
 */
export function useRealtimeEvents(handler: RealtimeListener): void {
  const { subscribe } = useRealtime()

  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  })

  useEffect(() => subscribe((event) => handlerRef.current(event)), [subscribe])
}
