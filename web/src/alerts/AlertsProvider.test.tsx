import { StrictMode, type ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RealtimeProvider } from '../realtime/RealtimeProvider'
import { alertRoutes } from '../test/alertStub'
import { createFakeSocket, FakeSocket } from '../test/fakeWebSocket'
import { jsonResponse, meResponse, stubFetch, textResponse } from '../test/fetchStub'
import { alertEventPayload, makeAlert } from '../test/fixtures'
import type { AlertRow } from '../api/types'
import { AlertsProvider } from './AlertsProvider'
import type { AlertsState } from './alertsContext'
import { useAlerts } from './useAlerts'

const makeWrapper =
  (syncMs?: number) =>
  ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <RealtimeProvider createSocket={createFakeSocket} url="ws://test/ws" baseDelayMs={10} maxDelayMs={20}>
        <AlertsProvider syncMs={syncMs}>{children}</AlertsProvider>
      </RealtimeProvider>
    </StrictMode>
  )

const liveSocket = () => {
  const alive = FakeSocket.instances.filter((s) => !s.closedByClient)
  const s = alive[alive.length - 1]
  if (s === undefined) throw new Error('yaşayan soket yok')
  return s
}
const open = () => act(() => liveSocket().open())
const send = (payload: unknown) => act(() => liveSocket().send(payload))

const alertsOf = (state: AlertsState): AlertRow[] => {
  if (state.status !== 'ready') throw new Error(`ready değil: ${state.status}`)
  return state.alerts
}

const alertCalls = (calls: { path: string }[]) => calls.filter((c) => c.path.startsWith('/api/v1/alerts')).length

describe('AlertsProvider', () => {
  it('açılışta üç durumu ayrı ayrı ister ve birleştirir', async () => {
    const rows = [
      makeAlert({ id: 1 }),
      makeAlert({ id: 2, status: 'acknowledged', acknowledged_by: 'Ada' }),
      makeAlert({ id: 3, status: 'resolved', resolved_at: '2030-01-01T10:10:00Z' }),
    ]
    const { calls } = stubFetch(alertRoutes(() => rows))
    const { result } = renderHook(() => useAlerts(), { wrapper: makeWrapper(60_000) })

    expect(result.current.state.status).toBe('loading')
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    expect(alertsOf(result.current.state).map((a) => a.id).sort()).toEqual([1, 2, 3])
    const paths = calls.map((c) => c.path).filter((p) => p.startsWith('/api/v1/alerts')).sort()
    expect(paths).toEqual([
      '/api/v1/alerts?status=acknowledged',
      '/api/v1/alerts?status=open',
      '/api/v1/alerts?status=resolved',
    ])
  })

  it('canlı "opened" olayı yeni alarmı REST\'e GİTMEDEN ekler (satır olaydan kurulur)', async () => {
    const { calls } = stubFetch(alertRoutes(() => []))
    const { result } = renderHook(() => useAlerts(), { wrapper: makeWrapper(60_000) })
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    await open()
    const before = alertCalls(calls)

    await send(alertEventPayload({ id: 7, node_name: 'db-01', rule_name: 'Disk dolu' }))

    expect(alertsOf(result.current.state)).toEqual([expect.objectContaining({ id: 7, node_name: 'db-01', rule_name: 'Disk dolu', status: 'open' })])
    expect(alertCalls(calls)).toBe(before)
  })

  it('başka kullanıcının incelemeye alması satırı anında günceller; eski "opened" onu geri almaz', async () => {
    stubFetch(alertRoutes(() => [makeAlert({ id: 1 })]))
    const { result } = renderHook(() => useAlerts(), { wrapper: makeWrapper(60_000) })
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    await open()

    await send(
      alertEventPayload({
        event: 'acknowledged',
        status: 'acknowledged',
        acknowledged_by: 'Bob',
        acknowledged_at: '2030-01-01T10:05:00Z',
      }),
    )
    expect(alertsOf(result.current.state)[0]).toMatchObject({ status: 'acknowledged', acknowledged_by: 'Bob' })

    await send(alertEventPayload()) // geç gelen eski "opened"
    expect(alertsOf(result.current.state)[0]).toMatchObject({ status: 'acknowledged', acknowledged_by: 'Bob' })
  })

  it('REST isteği SÜRERKEN gelen olay kaybolmaz ve eski anlık görüntü onu geri almaz', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const routes = alertRoutes(() => [makeAlert({ id: 1 })]) // sunucu bu isteği "açık" görüyordu
    stubFetch({
      ...routes,
      'GET /api/v1/alerts?status=open': async () => {
        await gate // yanıt geciktirilir
        return jsonResponse([makeAlert({ id: 1 })])
      },
    })
    const { result } = renderHook(() => useAlerts(), { wrapper: makeWrapper(60_000) })
    await open() // yükleme sürerken bağlantı açıldı

    await send(alertEventPayload({ event: 'acknowledged', status: 'acknowledged', acknowledged_by: 'Bob' }))
    await send(alertEventPayload({ id: 2 })) // yeni alarm da istek sırasında geldi
    release?.()

    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    const alerts = alertsOf(result.current.state)
    expect(alerts.find((a) => a.id === 1)).toMatchObject({ status: 'acknowledged', acknowledged_by: 'Bob' })
    expect(alerts.find((a) => a.id === 2)).toBeDefined()
  })

  it('WebSocket yeniden bağlanınca listeyi yükleme durumuna DÖNMEDEN REST\'ten eşitler', async () => {
    let rows = [makeAlert({ id: 1 })]
    const { calls } = stubFetch({ ...alertRoutes(() => rows), 'GET /api/v1/auth/me': () => jsonResponse(meResponse) })
    const seen: string[] = []
    const { result } = renderHook(
      () => {
        const value = useAlerts()
        seen.push(value.state.status)
        return value
      },
      { wrapper: makeWrapper(60_000) },
    )
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    await open()
    const before = alertCalls(calls)
    const readyAt = seen.length

    rows = [makeAlert({ id: 1, status: 'resolved', resolved_at: '2030-01-01T10:10:00Z' })] // kopukken çözüldü
    const dropped = liveSocket()
    await act(() => dropped.drop(1006))
    await waitFor(() => expect(liveSocket()).not.toBe(dropped), { timeout: 2000 })
    await open()

    await waitFor(() => expect(alertCalls(calls)).toBeGreaterThanOrEqual(before + 3))
    await waitFor(() => expect(alertsOf(result.current.state)[0]?.status).toBe('resolved'))
    expect(seen.slice(readyAt)).not.toContain('loading')
  })

  it('kural silindi olayı o kuralın alarmlarını kaldırır; sonraki eşitleme onları geri getirmez', async () => {
    let rows = [makeAlert({ id: 1, rule_id: 10 }), makeAlert({ id: 2, rule_id: 11 })]
    stubFetch(alertRoutes(() => rows))
    const { result } = renderHook(() => useAlerts(), { wrapper: makeWrapper(60_000) })
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    await open()

    await send({ type: 'rule', event: 'deleted', rule_id: 10 })
    expect(alertsOf(result.current.state).map((a) => a.id)).toEqual([2])

    // Sunucu eski bir yanıtı (kural henüz görünüyormuş gibi) verse bile silinen kuralın alarmı gösterilmez.
    rows = [makeAlert({ id: 1, rule_id: 10 }), makeAlert({ id: 2, rule_id: 11 })]
    act(() => result.current.reload())
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    expect(alertsOf(result.current.state).map((a) => a.id)).toEqual([2])
  })

  it('güvenlik ağı: periyodik eşitleme, olay kaybolmuşsa (Redis kesintisi) listeyi düzeltir', async () => {
    let rows: AlertRow[] = [makeAlert({ id: 1 })]
    stubFetch(alertRoutes(() => rows))
    const { result } = renderHook(() => useAlerts(), { wrapper: makeWrapper(60) }) // 60 ms
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    await open()

    // "resolved" olayı hiç ulaşmadı; sunucuda alarm çözüldü ve yeni bir alarm açıldı.
    rows = [makeAlert({ id: 1, status: 'resolved', resolved_at: '2030-01-01T10:10:00Z' }), makeAlert({ id: 2 })]

    await waitFor(() => expect(alertsOf(result.current.state).map((a) => `${a.id}:${a.status}`).sort()).toEqual(['1:resolved', '2:open']))
  })

  it('güvenlik ağı: olaydan öğrenilen ama sunucuda artık olmayan alarm, sonraki eşitlemede hayalet olarak KALMAZ', async () => {
    const rows: AlertRow[] = [makeAlert({ id: 1 })]
    stubFetch(alertRoutes(() => rows))
    const { result } = renderHook(() => useAlerts(), { wrapper: makeWrapper(60) })
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    await open()

    // Olayla bir alarm öğrenildi (id 9); sunucuda böyle bir alarm yok (ör. kuralı, "silindi" olayı kaçırılırken silindi).
    await send(alertEventPayload({ id: 9 }))

    // (Satırın kısa süre görünmesi yoklamayla yarışır; kalıcı olarak KALMAMASI asıl doğrulanan davranıştır.)
    await waitFor(() => expect(alertsOf(result.current.state).map((a) => a.id)).toEqual([1]))
  })

  it('yenileme başarısız olursa son bilinen liste kalır ve uyarı gösterilir', async () => {
    let fail = false
    stubFetch({
      'GET /api/v1/alerts?status=open': () => (fail ? textResponse('bozuk', 500) : jsonResponse([makeAlert({ id: 1 })])),
      'GET /api/v1/alerts?status=acknowledged': () => jsonResponse([]),
      'GET /api/v1/alerts?status=resolved': () => jsonResponse([]),
    })
    const { result } = renderHook(() => useAlerts(), { wrapper: makeWrapper(60) })
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    fail = true
    await waitFor(() => expect(result.current.state).toMatchObject({ status: 'ready', refreshError: expect.stringContaining('HTTP 500') }))
    expect(alertsOf(result.current.state)).toHaveLength(1)
  })
})

describe('acknowledge', () => {
  const ackResponse = (overrides: Partial<AlertRow> = {}) =>
    jsonResponse(
      alertEventPayload({
        event: 'acknowledged',
        status: 'acknowledged',
        acknowledged_by: 'Ada Test',
        acknowledged_at: '2030-01-01T10:05:00Z',
        ...overrides,
      }),
    )

  it('başarıda satır anında "incelemede" olur (WS olayını beklemeden)', async () => {
    const { calls } = stubFetch({ ...alertRoutes(() => [makeAlert({ id: 1 })]), 'POST /api/v1/alerts/1/ack': () => ackResponse() })
    const { result } = renderHook(() => useAlerts(), { wrapper: makeWrapper(60_000) })
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    let outcome: unknown
    await act(async () => {
      outcome = await result.current.acknowledge(1)
    })

    expect(outcome).toEqual({ kind: 'ok' })
    expect(alertsOf(result.current.state)[0]).toMatchObject({ status: 'acknowledged', acknowledged_by: 'Ada Test' })
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/v1/alerts/1/ack')).toBe(true)
  })

  it('409: çakışma mesajı döner ve liste REST\'ten yeniden eşitlenir', async () => {
    let rows = [makeAlert({ id: 1 })]
    const { calls } = stubFetch({
      ...alertRoutes(() => rows),
      'POST /api/v1/alerts/1/ack': () => textResponse("alarm zaten 'acknowledged' durumunda", 409),
    })
    const { result } = renderHook(() => useAlerts(), { wrapper: makeWrapper(60_000) })
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    const before = alertCalls(calls)

    rows = [makeAlert({ id: 1, status: 'acknowledged', acknowledged_by: 'Bob' })] // Bob önce davrandı
    let outcome: { kind: string; message?: string } | undefined
    await act(async () => {
      outcome = await result.current.acknowledge(1)
    })

    expect(outcome).toMatchObject({ kind: 'conflict', message: expect.stringContaining('başkası') })
    await waitFor(() => expect(alertCalls(calls)).toBeGreaterThanOrEqual(before + 3))
    await waitFor(() => expect(alertsOf(result.current.state)[0]).toMatchObject({ status: 'acknowledged', acknowledged_by: 'Bob' }))
  })

  it('404: alarm bulunamadı (çakışma türü) ve liste yenilenir', async () => {
    stubFetch({ ...alertRoutes(() => [makeAlert({ id: 1 })]), 'POST /api/v1/alerts/1/ack': () => textResponse('alarm bulunamadı', 404) })
    const { result } = renderHook(() => useAlerts(), { wrapper: makeWrapper(60_000) })
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    let outcome: { kind: string; message?: string } | undefined
    await act(async () => {
      outcome = await result.current.acknowledge(1)
    })
    expect(outcome).toMatchObject({ kind: 'conflict', message: expect.stringContaining('bulunamadı') })
  })

  it('ağ hatası ve sunucu hatası ayrı mesajlarla döner; liste değişmez', async () => {
    let status = 0
    stubFetch({
      ...alertRoutes(() => [makeAlert({ id: 1 })]),
      'POST /api/v1/alerts/1/ack': () => {
        if (status === 0) throw new TypeError('Failed to fetch')
        return textResponse('sunucu hatası', status)
      },
    })
    const { result } = renderHook(() => useAlerts(), { wrapper: makeWrapper(60_000) })
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    let network: unknown
    await act(async () => {
      network = await result.current.acknowledge(1)
    })
    expect(network).toEqual({ kind: 'error', message: 'Sunucuya ulaşılamadı.' })

    status = 500
    let server: unknown
    await act(async () => {
      server = await result.current.acknowledge(1)
    })
    expect(server).toEqual({ kind: 'error', message: 'İşlem başarısız (HTTP 500).' })
    expect(alertsOf(result.current.state)[0]?.status).toBe('open')
  })

  it('yanıt çözümlenemezse işlem başarılı sayılır ve doğrusu REST\'ten alınır', async () => {
    let rows = [makeAlert({ id: 1 })]
    const { calls } = stubFetch({ ...alertRoutes(() => rows), 'POST /api/v1/alerts/1/ack': () => jsonResponse({ garip: true }) })
    const { result } = renderHook(() => useAlerts(), { wrapper: makeWrapper(60_000) })
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    const before = alertCalls(calls)

    rows = [makeAlert({ id: 1, status: 'acknowledged', acknowledged_by: 'Ada Test' })]
    let outcome: unknown
    await act(async () => {
      outcome = await result.current.acknowledge(1)
    })

    expect(outcome).toEqual({ kind: 'ok' })
    await waitFor(() => expect(alertCalls(calls)).toBeGreaterThanOrEqual(before + 3))
  })
})
