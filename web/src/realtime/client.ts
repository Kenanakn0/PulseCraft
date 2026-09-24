import { parseEvent, type RealtimeEvent } from './events'

/** Sunucunun, oturum bittiğinde (logout / token süresi) WebSocket'i kapattığı özel kod. */
export const CLOSE_SESSION_ENDED = 4401

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

/** Tarayıcı WebSocket'inin kullandığımız bölümü; testte sahtesi verilebilsin diye ayrı arayüz. */
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
  /** Bağlantı (yeniden bağlanma dahil) açıldığında. `reconnected`: bu ilk açılış DEĞİL. */
  onOpen: (reconnected: boolean) => void
  /** Sunucu 4401 ile kapattı: yeniden bağlanma YOK. */
  onSessionEnded: () => void
  /** 4401 dışı her kopmada çağrılır (ör. oturum hâlâ geçerli mi diye sormak için). */
  onAbnormalClose?: (code: number) => void
  baseDelayMs?: number
  maxDelayMs?: number
  /** Bağlantı bu kadar süre açık kalırsa "sağlıklı" sayılıp backoff sıfırlanır. */
  stableAfterMs?: number
  random?: () => number
}

/**
 * Otomatik yeniden bağlanan WebSocket istemcisi. React'ten bağımsızdır (C#'ta bir arka plan
 * servisi / SignalR HubConnection'ın `WithAutomaticReconnect`'i gibi): yaşam döngüsünü
 * `start()`/`stop()` yönetir, olayları geri çağrımlarla bildirir.
 *
 * Yeniden bağlanma: üstel geri çekilme (1 sn, 2, 4 … tavan 30 sn) + rastgele "jitter". Jitter,
 * sunucu düşüp kalktığında tüm istemcilerin AYNI anda yeniden denemesini (thundering herd) önler.
 * Backoff, yalnızca bağlantı `stableAfterMs` boyunca açık kalırsa sıfırlanır; açılır açılmaz
 * düşen bir sunucuda saniyede bir vuran sıkı bir döngü oluşmaz.
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
      // Olay yöneticilerini önce sök: kapanış sonradan "kopma" gibi işlenip yeniden bağlanma planlamasın.
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

    // onerror'a ayrıca gerek yok: tarayıcı hatadan hemen sonra onclose'u da çağırır.
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
    const delay = ceiling * (0.5 + random() * 0.5) // ceiling'in %50-%100'ü
    this.retryTimer = setTimeout(() => this.connect(), delay)
  }
}
