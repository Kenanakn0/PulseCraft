import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { authApi } from '../api/auth'
import { notifyUnauthorized } from '../api/http'
import { RealtimeClient, type ConnectionStatus, type SocketLike } from './client'
import { RealtimeContext, type RealtimeContextValue, type RealtimeListener } from './realtimeContext'

interface RealtimeProviderProps {
  children: ReactNode
  /** Lets tests inject a fake socket. Default: the browser's WebSocket. */
  createSocket?: (url: string) => SocketLike
  url?: string
  baseDelayMs?: number
  maxDelayMs?: number
}

const defaultUrl = () => `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
const defaultCreateSocket = (url: string): SocketLike => new WebSocket(url)

/**
 * Keeps ONE WebSocket connection for the whole signed-in session and dispatches its events to
 * subscribers; pages subscribe with `useRealtimeEvents` instead of opening their own sockets.
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

  // Subscribers live in a ref: adding or removing one must not cause a re-render.
  const listeners = useRef(new Set<RealtimeListener>())

  // Initial connection parameters: changing them should not recreate the socket.
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
      // The server ended the session: no reconnect, the user returns to the login page.
      onSessionEnded: notifyUnauthorized,
      // Even when the handshake is rejected with 401, the browser only reports 1006 (no reason). So after every
      // disconnect the session is checked: a 401 (not silent) sends the user to login via the global notice.
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

  // Stable identity: status/epoch changes do not re-subscribe everyone.
  const subscribe = useCallback((listener: RealtimeListener) => {
    listeners.current.add(listener)
    return () => {
      listeners.current.delete(listener)
    }
  }, [])

  const value = useMemo<RealtimeContextValue>(() => ({ status, epoch, subscribe }), [status, epoch, subscribe])

  return <RealtimeContext value={value}>{children}</RealtimeContext>
}
