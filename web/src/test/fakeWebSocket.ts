import type { SocketLike } from '../realtime/client'

/**
 * Fake socket for tests: no network; the test triggers events by hand. `FakeSocket.instances` keeps every
 * socket created, in order.
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

  // --- triggers used by tests ---
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

export const createFakeSocket = (url: string) => new FakeSocket(url)

/** A "metric" event in the shape the server sends. */
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
