import { parseEvent, type RealtimeEvent } from './events'

/** Close code the server uses when the session ends (logout or token expiry). */
export const CLOSE_SESSION_ENDED = 4401

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

/** The part of the browser WebSocket we use; a separate interface so tests can fake it. */
export interface SocketLike {
  onopen: ((ev: Event) => void) | null
  onmessage: ((ev: MessageEvent) => void) | null
  onclose: ((ev: CloseEvent) => void) | null
  onerror: ((ev: Event) => void) | null
  close(code?: number): void
}

export interface ClientOptions {
  url: string
  createSocket: (url: string) => SocketLike
  onEvent: (event: RealtimeEvent) => void
  onStatus: (status: ConnectionStatus) => void
  /**
   * Called when a connection (including a reconnect) opens; `reconnected` is false only for the first one.
   */
  onOpen: (reconnected: boolean) => void
  /** The server closed with 4401: NO reconnect. */
  onSessionEnded: () => void
  /** Called on every disconnect except 4401 (e.g. to check whether the session is still valid). */
  onAbnormalClose?: (code: number) => void
  baseDelayMs?: number
  maxDelayMs?: number
  /** A connection that stays open this long counts as healthy and resets the backoff. */
  stableAfterMs?: number
  random?: () => number
}

/**
 * Auto-reconnecting WebSocket client, independent of React: `start()`/`stop()` control its lifetime and
 * callbacks report events.
 *
 * Reconnects use exponential backoff (1 s, 2, 4 … up to 30 s) plus random jitter, so that clients do not
 * all retry at the same moment when the server comes back (thundering herd). The backoff resets only after
 * the connection stayed open for `stableAfterMs`, so a server that accepts and drops at once does not
 * get hammered every second.
 */
export class RealtimeClient {
  private socket: SocketLike | null = null
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private stableTimer: ReturnType<typeof setTimeout> | undefined
  private attempt = 0
  private everOpened = false
  private stopped = true

  constructor(private readonly options: ClientOptions) {}

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    clearTimeout(this.retryTimer)
    clearTimeout(this.stableTimer)
    const socket = this.socket
    this.socket = null
    if (socket !== null) {
      // Detach the handlers first so the close is not handled as a drop that schedules a reconnect.
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null
      socket.close(1000)
    }
    this.options.onStatus('closed')
  }

  private connect(): void {
    this.options.onStatus(this.everOpened ? 'reconnecting' : 'connecting')
    const socket = this.options.createSocket(this.options.url)
    this.socket = socket

    socket.onopen = () => {
      if (this.socket !== socket) return
      const reconnected = this.everOpened
      this.everOpened = true
      this.options.onStatus('open')
      this.stableTimer = setTimeout(() => {
        this.attempt = 0
      }, this.options.stableAfterMs ?? 5000)
      this.options.onOpen(reconnected)
    }

    socket.onmessage = (ev) => {
      if (this.socket !== socket) return
      const event = parseEvent(ev.data)
      if (event !== null) this.options.onEvent(event)
    }

    // No onerror needed: the browser calls onclose right after an error.
    socket.onclose = (ev) => {
      if (this.socket !== socket) return
      this.socket = null
      clearTimeout(this.stableTimer)

      if (ev.code === CLOSE_SESSION_ENDED) {
        this.stopped = true
        this.options.onStatus('closed')
        this.options.onSessionEnded()
        return
      }

      this.options.onAbnormalClose?.(ev.code)
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    this.options.onStatus('reconnecting')
    const base = this.options.baseDelayMs ?? 1000
    const max = this.options.maxDelayMs ?? 30_000
    const ceiling = Math.min(max, base * 2 ** this.attempt)
    this.attempt++
    const random = this.options.random ?? Math.random
    const delay = ceiling * (0.5 + random() * 0.5) // 50-100 % of the ceiling
    this.retryTimer = setTimeout(() => this.connect(), delay)
  }
}
