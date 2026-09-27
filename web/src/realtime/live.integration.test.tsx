import { StrictMode, type ReactNode } from 'react'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../api/http'
import { LiveIndicator } from '../components/LiveIndicator'
import { useNodeMetrics } from '../metrics/useNodeMetrics'
import { useLiveMetrics } from '../nodes/useLiveMetrics'
import { useNodes } from '../nodes/useNodes'
import { jsonResponse, meResponse, stubFetch, textResponse } from '../test/fetchStub'
import { createFakeSocket, FakeSocket, metricEvent } from '../test/fakeWebSocket'
import { aggPoint, aggResponse, makeNode, rawPoint, rawResponse } from '../test/fixtures'
import { RealtimeProvider } from './RealtimeProvider'

// Inside <StrictMode>, like in development: effects are set up, cleaned up and set up again.
const wrapper = ({ children }: { children: ReactNode }) => (
  <StrictMode>
    <RealtimeProvider createSocket={createFakeSocket} url="ws://test/ws" baseDelayMs={10} maxDelayMs={20}>
      {children}
    </RealtimeProvider>
  </StrictMode>
)

/** StrictMode closes the first socket at once and opens another: returns the live (not closed) last one. */
const liveSocket = () => {
  const alive = FakeSocket.instances.filter((s) => !s.closedByClient)
  const s = alive[alive.length - 1]
  if (s === undefined) throw new Error('yaşayan soket yok')
  return s
}
const openSocket = () => act(() => liveSocket().open())
const send = (data: unknown) => act(() => liveSocket().send(data))

const ready = (result: { current: ReturnType<typeof useNodes> }) => {
  const s = result.current.state
  if (s.status !== 'ready') throw new Error(`ready değil: ${s.status}`)
  return s.nodes
}

describe('canlı akış + sunucu listesi', () => {
  it('daha yeni canlı ölçüm listedeki değerleri ve çevrimiçi durumunu anında günceller', async () => {
    stubFetch({
      'GET /api/v1/nodes': () =>
        jsonResponse([makeNode({ id: 'n1', online: false, last_seen_seconds_ago: 300 })]),
    })
    const { result } = renderHook(() => useNodes(60_000), { wrapper })
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    await openSocket()
    expect(ready(result)[0]).toMatchObject({ online: false })

    await send(metricEvent('n1', '2031-01-01T00:00:03Z', { cpu_percent: 88 }))

    expect(ready(result)[0]).toMatchObject({ online: true, last_seen_seconds_ago: 0 })
    expect(ready(result)[0]?.latest?.cpu_percent).toBe(88)
  })

  it('tekrarlı ve eski olaylar değeri geri almaz (idempotent)', async () => {
    stubFetch({ 'GET /api/v1/nodes': () => jsonResponse([makeNode({ id: 'n1' })]) })
    const { result } = renderHook(() => useNodes(60_000), { wrapper })
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    await openSocket()

    await send(metricEvent('n1', '2031-01-01T00:00:10Z', { cpu_percent: 50 }))
    await send(metricEvent('n1', '2031-01-01T00:00:05Z', { cpu_percent: 5 })) // stale, arrived late
    await send(metricEvent('n1', '2031-01-01T00:00:10Z', { cpu_percent: 6 })) // same time, repeated

    expect(ready(result)[0]?.latest?.cpu_percent).toBe(50)
  })

  it('bilinmeyen sunucunun olayı listeye sunucu EKLEMEZ; alarm olayları yok sayılır', async () => {
    stubFetch({ 'GET /api/v1/nodes': () => jsonResponse([makeNode({ id: 'n1' })]) })
    const { result } = renderHook(() => useNodes(60_000), { wrapper })
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    await openSocket()

    await send(metricEvent('baska', '2031-01-01T00:00:10Z'))
    await send({ type: 'alert', event: 'opened', alert_id: 1, node_id: 'n1', status: 'open' })

    expect(ready(result)).toHaveLength(1)
    expect(ready(result)[0]?.latest?.cpu_percent).toBe(42.5)
  })

  it("WebSocket yeniden bağlanınca liste, yükleme durumuna DÖNMEDEN REST'ten hemen yenilenir", async () => {
    const { calls } = stubFetch({
      'GET /api/v1/nodes': () => jsonResponse([makeNode({ id: 'n1' })]),
      'GET /api/v1/auth/me': () => jsonResponse(meResponse),
    })
    const seen: string[] = []
    const { result } = renderHook(
      () => {
        const value = useNodes(60_000) // polling is 60 s: a refresh can ONLY come from the reconnect
        seen.push(value.state.status)
        return value
      },
      { wrapper },
    )
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    await openSocket()
    const listCalls = () => calls.filter((c) => c.path === '/api/v1/nodes').length
    const before = listCalls()
    const readyAt = seen.length

    // Disconnect → (backoff) → new socket → open
    const dropped = liveSocket()
    await act(() => dropped.drop(1006))
    await waitFor(() => expect(liveSocket()).not.toBe(dropped), { timeout: 2000 })
    await openSocket()

    await waitFor(() => expect(listCalls()).toBe(before + 1))
    expect(seen.slice(readyAt)).not.toContain('loading')
  })
})

describe('canlı akış + sunucu silme', () => {
  it('başka yerde silinen sunucu, yoklamayı beklemeden listeden düşer', async () => {
    stubFetch({
      'GET /api/v1/nodes': () => jsonResponse([makeNode({ id: 'n1', name: 'web-01' }), makeNode({ id: 'n2', name: 'db-01' })]),
    })
    const { result } = renderHook(() => useNodes(60_000), { wrapper })
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    await openSocket()

    await send({ type: 'node', event: 'deleted', node_id: 'n1' })

    expect(ready(result).map((n) => n.id)).toEqual(['n2'])
  })
})

describe('sessizlik zamanlayıcısı', () => {
  it('olay gelmeyince sunucu ZAMANLAYICIYLA çevrimdışı olur; yeni olay onu yeniden çevrimiçi yapar', async () => {
    const { result } = renderHook(() => useLiveMetrics(60), { wrapper })
    await openSocket()

    await send(metricEvent('n1', '2031-01-01T00:00:00Z'))
    expect(result.current['n1']?.online).toBe(true)

    await waitFor(() => expect(result.current['n1']?.online).toBe(false), { timeout: 1000 })

    await send(metricEvent('n1', '2031-01-01T00:00:03Z'))
    expect(result.current['n1']?.online).toBe(true)
  })

  it('bileşen kalkınca bekleyen zamanlayıcı çalışmaz (cleanup)', async () => {
    const { result, unmount } = renderHook(() => useLiveMetrics(30), { wrapper })
    await openSocket()
    await send(metricEvent('n1', '2031-01-01T00:00:00Z'))
    expect(result.current['n1']?.online).toBe(true)

    const spy = vi.spyOn(console, 'error')
    unmount()
    await new Promise((r) => setTimeout(r, 100))
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('canlı akış + geçmiş grafiği', () => {
  const base = () =>
    rawResponse([rawPoint('2030-01-01T00:00:00Z'), rawPoint('2030-01-01T00:00:03Z'), rawPoint('2030-01-01T00:00:06Z')])

  it('ham veride yeni noktalar eklenir, pencere kayar; başka sunucunun olayı eklenmez', async () => {
    stubFetch({ 'GET /api/v1/nodes/n1/metrics?last=15m': () => jsonResponse(base()) })
    const { result } = renderHook(() => useNodeMetrics('n1', '15m'), { wrapper })
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    await openSocket()

    await send(metricEvent('n1', '2030-01-01T00:00:09Z', { cpu_percent: 77 }))
    await send(metricEvent('digeri', '2030-01-01T00:00:12Z'))

    const state = result.current.state
    if (state.status !== 'ready') throw new Error('ready değil')
    expect(state.points).toHaveLength(4)
    expect(state.points.at(-1)).toMatchObject({ t: Date.parse('2030-01-01T00:00:09Z'), cpu: 77 })
    // The server's window was 00:00:00 - 00:15:00; the live point falls inside → the window does not move.
    expect(state.to).toBe(Date.parse('2030-01-01T00:15:00Z'))
  })

  it('REST\'te zaten olan (eski/aynı zamanlı) olay nokta çoğaltmaz', async () => {
    stubFetch({ 'GET /api/v1/nodes/n1/metrics?last=15m': () => jsonResponse(base()) })
    const { result } = renderHook(() => useNodeMetrics('n1', '15m'), { wrapper })
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    await openSocket()

    await send(metricEvent('n1', '2030-01-01T00:00:06Z'))
    await send(metricEvent('n1', '2030-01-01T00:00:03Z'))

    const state = result.current.state
    if (state.status !== 'ready') throw new Error('ready değil')
    expect(state.points).toHaveLength(3)
  })

  it('dakikalık özet (6 sa) grafiğine canlı nokta KARIŞMAZ', async () => {
    stubFetch({
      'GET /api/v1/nodes/n1/metrics?last=6h': () =>
        jsonResponse(aggResponse([aggPoint('2030-01-01T00:00:00Z'), aggPoint('2030-01-01T00:01:00Z')])),
    })
    const { result } = renderHook(() => useNodeMetrics('n1', '6h'), { wrapper })
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    await openSocket()

    await send(metricEvent('n1', '2030-01-01T00:02:00Z'))

    const state = result.current.state
    if (state.status !== 'ready') throw new Error('ready değil')
    expect(state.points).toHaveLength(2)
  })
})

describe('oturum bitişi ve kopmalar', () => {
  it('sunucu 4401 ile kapatınca oturum bitti bildirilir ve YENİDEN BAĞLANILMAZ', async () => {
    const listener = vi.fn()
    const off = onUnauthorized(listener)
    render(<LiveIndicator />, { wrapper })
    await openSocket()

    const count = FakeSocket.instances.length
    await act(() => liveSocket().drop(4401))
    await new Promise((r) => setTimeout(r, 100)) // the backoff (10 ms) is long over; no new socket may open

    expect(listener).toHaveBeenCalledTimes(1)
    expect(FakeSocket.instances).toHaveLength(count)
    expect(screen.getByTestId('live-status')).toHaveTextContent('Bağlantı yok')
    off()
  })

  it('anormal kopmada oturum sorgulanır; 401 ise (el sıkışma reddi) oturum bitti bildirilir', async () => {
    stubFetch({ 'GET /api/v1/auth/me': () => textResponse('oturum yok', 401) })
    const listener = vi.fn()
    const off = onUnauthorized(listener)
    render(<LiveIndicator />, { wrapper })
    await openSocket()

    await act(() => liveSocket().drop(1006))

    await waitFor(() => expect(listener).toHaveBeenCalled())
    off()
  })

  it('oturum hâlâ geçerliyse kopma "oturum bitti" sayılmaz', async () => {
    const { calls } = stubFetch({ 'GET /api/v1/auth/me': () => jsonResponse(meResponse) })
    const listener = vi.fn()
    const off = onUnauthorized(listener)
    render(<LiveIndicator />, { wrapper })
    await openSocket()

    await act(() => liveSocket().drop(1006))
    await waitFor(() => expect(calls.some((c) => c.path === '/api/v1/auth/me')).toBe(true))

    expect(listener).not.toHaveBeenCalled()
    off()
  })

  it('bağlantı göstergesi durumu yansıtır: Bağlanıyor → Canlı → Yeniden bağlanıyor', async () => {
    stubFetch({ 'GET /api/v1/auth/me': () => jsonResponse(meResponse) })
    render(<LiveIndicator />, { wrapper })
    expect(screen.getByTestId('live-status')).toHaveTextContent('Bağlanıyor…')

    await openSocket()
    expect(screen.getByTestId('live-status')).toHaveTextContent('Canlı')

    await act(() => liveSocket().drop(1006))
    expect(screen.getByTestId('live-status')).toHaveTextContent('Yeniden bağlanıyor…')
  })
})
