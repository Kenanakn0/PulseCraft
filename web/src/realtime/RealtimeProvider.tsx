import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { authApi } from '../api/auth'
import { notifyUnauthorized } from '../api/http'
import { RealtimeClient, type ConnectionStatus, type SocketLike } from './client'
import { RealtimeContext, type RealtimeContextValue, type RealtimeListener } from './realtimeContext'

interface RealtimeProviderProps {
  children: ReactNode
  /** Testte sahte soket vermek için. Varsayılan: tarayıcının WebSocket'i. */
  createSocket?: (url: string) => SocketLike
  url?: string
  baseDelayMs?: number
  maxDelayMs?: number
}

const defaultUrl = () => `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
const defaultCreateSocket = (url: string): SocketLike => new WebSocket(url)

/**
 * Giriş yapılmış oturum boyunca TEK bir WebSocket bağlantısı tutar ve gelen olayları abonelere dağıtır
 * (C#'ta uygulama ömürlü tek bir SignalR bağlantısı + bir olay aracısı gibi). Her sayfa kendi
 * soketini açmaz; sayfalar `useRealtimeEvents` ile bu ortak akışa abone olur.
 */
export function RealtimeProvider({
  children,
  createSocket = defaultCreateSocket,
  url,
  baseDelayMs,
  maxDelayMs,
}: RealtimeProviderProps) {
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [epoch, setEpoch] = useState(0)

  // Aboneler bir ref'te tutulur: abone eklemek/çıkarmak ekranı yeniden ÇİZDİRMEMELİ.
  const listeners = useRef(new Set<RealtimeListener>())

  // Bağlantı parametrelerinin ilk değerleri: bunlar değişince soketi yeniden kurmak istemeyiz.
  const initial = useRef({ createSocket, url, baseDelayMs, maxDelayMs })

  useEffect(() => {
    const { createSocket: create, url: customUrl, baseDelayMs: base, maxDelayMs: max } = initial.current
    const probeController = new AbortController()

    const client = new RealtimeClient({
      url: customUrl ?? defaultUrl(),
      createSocket: create,
      baseDelayMs: base,
      maxDelayMs: max,
      onStatus: setStatus,
      onEvent: (event) => {
        for (const listener of listeners.current) listener(event)
      },
      onOpen: (reconnected) => {
        if (reconnected) setEpoch((n) => n + 1)
      },
      // Sunucu "oturum bitti" dedi: yeniden bağlanma yok, kullanıcı giriş ekranına döner.
      onSessionEnded: notifyUnauthorized,
      // Tarayıcı, el sıkışması 401 ile reddedilse bile yalnızca 1006 verir (nedeni söylemez). Her
      // kopmada oturumu sorarız: 401 gelirse (silent401 KAPALI) global bildirim giriş ekranına götürür.
      onAbnormalClose: () => {
        authApi.probe(probeController.signal).catch(() => undefined)
      },
    })
    client.start()

    return () => {
      probeController.abort()
      client.stop()
    }
  }, [])

  // useCallback: `subscribe`'ın kimliği hiç değişmez; durum/epoch değişince aboneler yeniden kurulmaz.
  const subscribe = useCallback((listener: RealtimeListener) => {
    listeners.current.add(listener)
    return () => {
      listeners.current.delete(listener)
    }
  }, [])

  const value = useMemo<RealtimeContextValue>(() => ({ status, epoch, subscribe }), [status, epoch, subscribe])

  return <RealtimeContext value={value}>{children}</RealtimeContext>
}
