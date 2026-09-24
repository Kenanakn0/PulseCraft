import type { SocketLike } from '../realtime/client'

/**
 * Testler için sahte soket: gerçek ağ yok, olayları test elle tetikler.
 * `FakeSocket.instances` oluşturulan tüm soketleri sırayla tutar.
 */
export class FakeSocket implements SocketLike {
  static instances: FakeSocket[] = []
  static reset() {
    FakeSocket.instances = []
  }
  static get last(): FakeSocket {
    const s = FakeSocket.instances[FakeSocket.instances.length - 1]
    if (s === undefined) throw new Error('Henüz soket oluşturulmadı')
    return s
  }

  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onclose: ((ev: CloseEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  closedByClient = false

  constructor(readonly url: string) {
    FakeSocket.instances.push(this)
  }

  close() {
    this.closedByClient = true
  }

  // --- testin kullandığı tetikleyiciler ---
  open() {
    this.onopen?.(new Event('open'))
  }
  send(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) } as MessageEvent)
  }
  drop(code = 1006) {
    this.onclose?.({ code } as CloseEvent)
  }
}

/** Provider'a verilecek fabrika. */
export const createFakeSocket = (url: string) => new FakeSocket(url)

/** Sunucunun gönderdiği biçimde bir "metric" olayı. */
export function metricEvent(nodeId: string, time: string, overrides: Record<string, unknown> = {}) {
  return {
    type: 'metric',
    node_id: nodeId,
    time,
    cpu_percent: 10,
    mem_percent: 20,
    mem_used_bytes: 1000,
    disk_percent: 30,
    net_rx_bps: 100,
    net_tx_bps: 50,
    ...overrides,
  }
}
