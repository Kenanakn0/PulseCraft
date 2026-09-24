import { StrictMode, type ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { jsonResponse, stubFetch, textResponse } from '../test/fetchStub'
import { makeNode } from '../test/fixtures'
import { useNodes } from './useNodes'

// Geliştirmedeki gibi <StrictMode> içinde çalıştır: effect'ler iki kez kurulup temizlenir.
const strict = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>

const nodesCalls = (calls: { path: string }[]) => calls.filter((c) => c.path === '/api/v1/nodes').length

describe('useNodes', () => {
  it('önce loading, sonra ready durumuna geçer', async () => {
    stubFetch({ 'GET /api/v1/nodes': () => jsonResponse([makeNode()]) })

    const { result } = renderHook(() => useNodes(60_000), { wrapper: strict })

    expect(result.current.state.status).toBe('loading')
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    expect(result.current.state).toMatchObject({ status: 'ready', refreshError: null })
    if (result.current.state.status === 'ready') expect(result.current.state.nodes).toHaveLength(1)
  })

  it('belirtilen aralıkla yeniden yükler', async () => {
    const { calls } = stubFetch({ 'GET /api/v1/nodes': () => jsonResponse([makeNode()]) })

    renderHook(() => useNodes(30))

    await waitFor(() => expect(nodesCalls(calls)).toBeGreaterThanOrEqual(3))
  })

  it('bileşen kalkınca zamanlayıcıyı durdurur (cleanup)', async () => {
    const { calls } = stubFetch({ 'GET /api/v1/nodes': () => jsonResponse([makeNode()]) })
    const { unmount } = renderHook(() => useNodes(30))
    await waitFor(() => expect(nodesCalls(calls)).toBeGreaterThanOrEqual(2))

    unmount()
    const afterUnmount = nodesCalls(calls)
    await new Promise((resolve) => setTimeout(resolve, 150)) // ~5 aralık boyunca bekle

    expect(nodesCalls(calls)).toBe(afterUnmount) // yeni istek atılmadı
  })

  it('yavaş yanıtta istekler üst üste binmez', async () => {
    let inflight = 0
    let maxInflight = 0
    const { calls } = stubFetch({
      'GET /api/v1/nodes': async () => {
        inflight++
        maxInflight = Math.max(maxInflight, inflight)
        await new Promise((resolve) => setTimeout(resolve, 60)) // aralıktan (10 ms) çok daha yavaş
        inflight--
        return jsonResponse([makeNode()])
      },
    })

    renderHook(() => useNodes(10))
    await waitFor(() => expect(nodesCalls(calls)).toBeGreaterThanOrEqual(3), { timeout: 2000 })

    expect(maxInflight).toBe(1)
  })

  it('ilk yükleme başarısızsa error olur; reload() yeniden dener', async () => {
    let fail = true
    stubFetch({
      'GET /api/v1/nodes': () => (fail ? textResponse('bozuk', 500) : jsonResponse([makeNode()])),
    })

    const { result } = renderHook(() => useNodes(60_000))
    await waitFor(() => expect(result.current.state.status).toBe('error'))
    expect(result.current.state).toMatchObject({ message: 'Sunucu listesi alınamadı (HTTP 500).' })

    fail = false
    act(() => result.current.reload())
    expect(result.current.state.status).toBe('loading')
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
  })

  it('ağ hatasında anlaşılır mesaj verir', async () => {
    stubFetch({
      'GET /api/v1/nodes': () => {
        throw new TypeError('Failed to fetch')
      },
    })
    const { result } = renderHook(() => useNodes(60_000))

    await waitFor(() => expect(result.current.state.status).toBe('error'))
    expect(result.current.state).toMatchObject({ message: 'Sunucuya ulaşılamadı.' })
  })

  it('yükleme sonrası bir yenileme başarısız olursa verileri korur, sonraki başarıda uyarıyı temizler', async () => {
    // Hata, testin bayrağı kapatmasına kadar SÜRER; böylece kısa bir hata penceresini
    // yoklamayla kaçırma (kararsız test) riski olmaz.
    let failing = false
    let call = 0
    stubFetch({
      'GET /api/v1/nodes': () => {
        call++
        return failing ? textResponse('geçici hata', 503) : jsonResponse([makeNode({ name: `v${call}` })])
      },
    })
    const nameOf = (state: ReturnType<typeof useNodes>['state']) =>
      state.status === 'ready' ? state.nodes[0]?.name : undefined

    const { result } = renderHook(() => useNodes(40))
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    // Yenileme başarısız oluyor: eski veri korunur, uyarı görünür.
    failing = true
    await waitFor(() =>
      expect(result.current.state).toMatchObject({ status: 'ready', refreshError: 'Sunucu listesi alınamadı (HTTP 503).' }),
    )
    const keptName = nameOf(result.current.state)
    expect(keptName).toMatch(/^v\d+$/) // hâlâ bir önceki başarılı yanıtın verisi

    // Sunucu düzeldi: uyarı kalkar ve veri yenilenir.
    failing = false
    await waitFor(() => expect(result.current.state).toMatchObject({ status: 'ready', refreshError: null }))
    await waitFor(() => expect(nameOf(result.current.state)).not.toBe(keptName))
  })
})
