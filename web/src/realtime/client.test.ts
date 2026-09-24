import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSocket, FakeSocket, metricEvent } from '../test/fakeWebSocket'
import { RealtimeClient, type ConnectionStatus } from './client'
import type { RealtimeEvent } from './events'

function setup(overrides: Partial<ConstructorParameters<typeof RealtimeClient>[0]> = {}) {
  const statuses: ConnectionStatus[] = []
  const events: RealtimeEvent[] = []
  const opens: boolean[] = []
  const onSessionEnded = vi.fn()
  const onAbnormalClose = vi.fn()

  const client = new RealtimeClient({
    url: 'ws://test/ws',
    createSocket: createFakeSocket,
    onEvent: (e) => events.push(e),
    onStatus: (s) => statuses.push(s),
    onOpen: (r) => opens.push(r),
    onSessionEnded,
    onAbnormalClose,
    random: () => 1, // jitter'ı sabitle: gecikme = tavan
    ...overrides,
  })
  return { client, statuses, events, opens, onSessionEnded, onAbnormalClose }
}

describe('RealtimeClient', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('bağlanır, açılınca durumu open yapar ve olayları iletir', () => {
    const { client, statuses, events, opens } = setup()
    client.start()
    expect(statuses).toEqual(['connecting'])
    expect(FakeSocket.last.url).toBe('ws://test/ws')

    FakeSocket.last.open()
    FakeSocket.last.send(metricEvent('n1', '2030-01-01T00:00:00Z'))

    expect(statuses).toEqual(['connecting', 'open'])
    expect(opens).toEqual([false])
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'metric', node_id: 'n1', cpu_percent: 10 })
  })

  it('bozuk/bilinmeyen mesajları sessizce atar', () => {
    const { client, events } = setup()
    client.start()
    FakeSocket.last.open()

    FakeSocket.last.send('bu json değil')
    FakeSocket.last.send({ type: 'bilinmeyen' })
    FakeSocket.last.send(metricEvent('n1', 'zaman-degil'))
    FakeSocket.last.send(metricEvent('n1', '2030-01-01T00:00:00Z', { cpu_percent: 'yüksek' }))

    expect(events).toHaveLength(0)
  })

  it('kopunca üstel geri çekilmeyle yeniden bağlanır (1s, 2s, 4s … tavan)', () => {
    const { client, statuses, onAbnormalClose } = setup({ baseDelayMs: 1000, maxDelayMs: 5000 })
    client.start()
    expect(FakeSocket.instances).toHaveLength(1)

    // Hiç açılmadan üst üste başarısız denemeler: 1000, 2000, 4000, 5000 (tavan), 5000
    for (const [i, delay] of [1000, 2000, 4000, 5000, 5000].entries()) {
      FakeSocket.last.drop(1006)
      expect(FakeSocket.instances).toHaveLength(i + 1)
      vi.advanceTimersByTime(delay - 1)
      expect(FakeSocket.instances, `${delay} ms dolmadan`).toHaveLength(i + 1)
      vi.advanceTimersByTime(1)
      expect(FakeSocket.instances, `${delay} ms sonra`).toHaveLength(i + 2)
    }

    expect(onAbnormalClose).toHaveBeenCalledTimes(5)
    expect(statuses).toContain('reconnecting')
  })

  it('jitter: gecikme tavanın %50-%100 aralığındadır', () => {
    const { client } = setup({ baseDelayMs: 1000, random: () => 0 })
    client.start()
    FakeSocket.last.drop(1006)

    vi.advanceTimersByTime(499)
    expect(FakeSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.instances).toHaveLength(2)
  })

  it('yeniden açılınca onOpen(true) çağrılır (ilk açılış false)', () => {
    const { client, opens, statuses } = setup()
    client.start()
    FakeSocket.last.open()
    FakeSocket.last.drop(1006)
    vi.advanceTimersByTime(1000)
    FakeSocket.last.open()

    expect(opens).toEqual([false, true])
    expect(statuses.at(-1)).toBe('open')
  })

  it('bağlantı kararlı kaldıysa (5 sn açık) geri çekilme sıfırlanır; açılır açılmaz düşen sunucuda sıfırlanmaz', () => {
    const { client } = setup({ baseDelayMs: 1000, stableAfterMs: 5000 })
    client.start()

    // Açılıp hemen düşüyor: gecikme büyümeye devam etmeli (1000 → 2000).
    FakeSocket.last.open()
    FakeSocket.last.drop(1006)
    vi.advanceTimersByTime(1000)
    FakeSocket.last.open()
    FakeSocket.last.drop(1006)
    vi.advanceTimersByTime(1999)
    expect(FakeSocket.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.instances).toHaveLength(3)

    // Bu kez 5 sn açık kalıyor → sıfırlanır → sonraki gecikme yine 1000.
    FakeSocket.last.open()
    vi.advanceTimersByTime(5000)
    FakeSocket.last.drop(1006)
    vi.advanceTimersByTime(1000)
    expect(FakeSocket.instances).toHaveLength(4)
  })

  it('4401: yeniden bağlanmaz ve oturum bitti bildirir', () => {
    const { client, statuses, onSessionEnded, onAbnormalClose } = setup()
    client.start()
    FakeSocket.last.open()

    FakeSocket.last.drop(4401)
    vi.advanceTimersByTime(120_000)

    expect(onSessionEnded).toHaveBeenCalledTimes(1)
    expect(onAbnormalClose).not.toHaveBeenCalled()
    expect(FakeSocket.instances).toHaveLength(1)
    expect(statuses.at(-1)).toBe('closed')
  })

  it('1008 (yavaş istemci düşürüldü) ve 1006 yeniden bağlanır', () => {
    const { client } = setup()
    client.start()
    FakeSocket.last.open()
    FakeSocket.last.drop(1008)
    vi.advanceTimersByTime(1000)
    expect(FakeSocket.instances).toHaveLength(2)
  })

  it('stop(): soketi kapatır, bekleyen yeniden bağlanmayı iptal eder, sonradan gelen olayları yok sayar', () => {
    const { client, events, statuses } = setup()
    client.start()
    const first = FakeSocket.last
    first.open()
    client.stop()

    expect(first.closedByClient).toBe(true)
    first.send(metricEvent('n1', '2030-01-01T00:00:00Z')) // söküldü: iletilmez
    expect(events).toHaveLength(0)
    expect(statuses.at(-1)).toBe('closed')

    // Bekleyen bir yeniden bağlanma da kalmamalı
    const again = setup()
    again.client.start()
    FakeSocket.last.drop(1006)
    again.client.stop()
    const count = FakeSocket.instances.length
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances).toHaveLength(count)
  })

  it('eski (yerine yenisi bağlanmış) soketin geç gelen olayları yok sayılır', () => {
    const { client, events } = setup()
    client.start()
    const old = FakeSocket.last
    old.open()
    old.drop(1006)
    vi.advanceTimersByTime(1000)
    FakeSocket.last.open()

    old.send(metricEvent('n1', '2030-01-01T00:00:00Z'))
    expect(events).toHaveLength(0)
  })
})
