import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { jsonResponse, stubFetch, textResponse } from '../test/fetchStub'
import { aggPoint, aggResponse, makeNode, rawPoint, rawResponse } from '../test/fixtures'
import NodeDetailPage from './NodeDetailPage'

// jsdom'da canvas yok: grafik bileşenlerini, aldıkları props'u kaydeden sahtelerle değiştiriyoruz.
// (Grafiğin GERÇEK çizimi Playwright testinde, gerçek tarayıcıda doğrulanır.)
const charts = vi.hoisted(() => ({
  lines: [] as { data: { datasets: { label: string; data: unknown[] }[] }; options: unknown }[],
  doughnuts: [] as { data: { datasets: { data: number[] }[] } }[],
}))

vi.mock('react-chartjs-2', () => ({
  Line: (props: (typeof charts.lines)[number]) => {
    charts.lines.push(props)
    return <canvas data-testid="line-canvas" />
  },
  Doughnut: (props: (typeof charts.doughnuts)[number]) => {
    charts.doughnuts.push(props)
    return <canvas data-testid="doughnut-canvas" />
  },
}))

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname + location.search}</output>
}

const renderPage = (url = '/nodes/node-1') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/" element={<p>Sunucu listesi sayfası</p>} />
        <Route path="/nodes/:id" element={<NodeDetailPage />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  )

const nodes = (...list: ReturnType<typeof makeNode>[]) => () => jsonResponse(list)
const raw = () =>
  jsonResponse(rawResponse([rawPoint('2030-01-01T00:00:00Z'), rawPoint('2030-01-01T00:00:03Z', { cpu_percent: 90 })]))

describe('NodeDetailPage', () => {
  it('sunucu bilgisini, gösterge değerlerini ve iki grafiği çizer; varsayılan aralık 15 dk', async () => {
    const { calls } = stubFetch({
      'GET /api/v1/nodes': nodes(makeNode()),
      'GET /api/v1/nodes/node-1/metrics?last=15m': raw,
    })
    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: 'web-01' })).toBeInTheDocument()
    expect(screen.getByText('Çevrimiçi')).toBeInTheDocument()
    expect(screen.getByTestId('gauge-CPU')).toHaveTextContent('42,5 %')
    expect(screen.getByTestId('gauge-RAM')).toHaveTextContent('61,0 %')
    expect(screen.getByTestId('gauge-Disk')).toHaveTextContent('70,3 %')

    expect(await screen.findAllByTestId('line-canvas')).toHaveLength(2)
    expect(screen.getByRole('img', { name: /CPU ve RAM kullanımı/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Ağ indirme ve gönderme/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '15 dk' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/ham ölçümler · 2 nokta/)).toBeInTheDocument()
    expect(calls.filter((c) => c.path.includes('/metrics'))).toHaveLength(1)
  })

  it('göstergelere düğümün son değerleri, grafiklere sunucunun penceresi ve noktalar verilir', async () => {
    stubFetch({
      'GET /api/v1/nodes': nodes(makeNode()),
      'GET /api/v1/nodes/node-1/metrics?last=15m': raw,
    })
    renderPage()
    await screen.findAllByTestId('line-canvas')

    const gaugeValues = charts.doughnuts.map((d) => d.data.datasets[0]?.data[0])
    expect(gaugeValues).toEqual(expect.arrayContaining([42.5, 61, 70.25]))

    const cpuMem = charts.lines.at(-2)!
    expect(cpuMem.data.datasets.map((d) => d.label)).toEqual(['CPU', 'RAM'])
    expect(cpuMem.data.datasets[0]?.data).toEqual([
      { x: Date.parse('2030-01-01T00:00:00Z'), y: 10 },
      { x: Date.parse('2030-01-01T00:00:03Z'), y: 90 },
    ])
    const scales = (cpuMem.options as { scales: { x: { min: number; max: number } } }).scales
    expect(scales.x.min).toBe(Date.parse('2030-01-01T00:00:00Z'))
    expect(scales.x.max).toBe(Date.parse('2030-01-01T00:15:00Z'))
  })

  it('aralık düğmesi adresi günceller ve sunucudan o pencereyi ister', async () => {
    const { calls } = stubFetch({
      'GET /api/v1/nodes': nodes(makeNode()),
      'GET /api/v1/nodes/node-1/metrics?last=15m': raw,
      'GET /api/v1/nodes/node-1/metrics?last=6h': () => jsonResponse(aggResponse([aggPoint('2030-01-01T00:00:00Z')])),
    })
    renderPage()
    const user = userEvent.setup()
    await screen.findAllByTestId('line-canvas')

    await user.click(screen.getByRole('button', { name: '6 sa' }))

    expect(await screen.findByText(/dakikalık ortalama · 1 nokta/)).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/nodes/node-1?range=6h')
    expect(screen.getByRole('button', { name: '6 sa' })).toHaveAttribute('aria-pressed', 'true')
    expect(calls.some((c) => c.path === '/api/v1/nodes/node-1/metrics?last=6h')).toBe(true)
  })

  it('aralık değişince eski aralığın grafiği kalmaz: yeni veri gelene dek "yükleniyor" görünür (key ile sıfırlama)', async () => {
    stubFetch({
      'GET /api/v1/nodes': nodes(makeNode()),
      'GET /api/v1/nodes/node-1/metrics?last=15m': raw,
      'GET /api/v1/nodes/node-1/metrics?last=1h': () => new Promise<Response>(() => undefined),
    })
    renderPage()
    const user = userEvent.setup()
    await screen.findAllByTestId('line-canvas')

    await user.click(screen.getByRole('button', { name: '1 sa' }))

    expect(await screen.findByText('Ölçümler yükleniyor…')).toBeInTheDocument()
    expect(screen.queryByTestId('line-canvas')).not.toBeInTheDocument()
  })

  it('adresteki ?range= ile açılır; geçersiz değer varsayılana düşer', async () => {
    stubFetch({
      'GET /api/v1/nodes': nodes(makeNode()),
      'GET /api/v1/nodes/node-1/metrics?last=1h': raw,
      'GET /api/v1/nodes/node-1/metrics?last=15m': raw,
    })
    const first = renderPage('/nodes/node-1?range=1h')
    await screen.findAllByTestId('line-canvas')
    expect(screen.getByRole('button', { name: '1 sa' })).toHaveAttribute('aria-pressed', 'true')
    first.unmount()

    renderPage('/nodes/node-1?range=zzz')
    await screen.findAllByTestId('line-canvas')
    expect(screen.getByRole('button', { name: '15 dk' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('çevrimdışı sunucuyu soluk gösterir', async () => {
    stubFetch({
      'GET /api/v1/nodes': nodes(makeNode({ online: false, last_seen_seconds_ago: 600 })),
      'GET /api/v1/nodes/node-1/metrics?last=15m': raw,
    })
    renderPage()

    expect(await screen.findByText('Çevrimdışı')).toBeInTheDocument()
    expect(screen.getByText(/Son görülme: 10 dk önce/)).toBeInTheDocument()
    expect(screen.getByTestId('gauge-CPU').closest('.gauge-row')).toHaveClass('stale')
  })

  it('hiç ölçümü olmayan sunucuda göstergeler boş ("—") olur', async () => {
    stubFetch({
      'GET /api/v1/nodes': nodes(makeNode({ latest: null })),
      'GET /api/v1/nodes/node-1/metrics?last=15m': () => jsonResponse(rawResponse([])),
    })
    renderPage()

    expect(await screen.findByText('Bu aralıkta ölçüm yok.')).toBeInTheDocument()
    expect(within(screen.getByTestId('gauge-CPU')).getByText('—')).toBeInTheDocument()
    expect(screen.queryByTestId('line-canvas')).not.toBeInTheDocument()
    expect(screen.queryByText(/dakikalık özetten/)).not.toBeInTheDocument()
  })

  it('uzun aralıkta boş sonuç, özetin gecikmesi hakkında ipucu verir', async () => {
    stubFetch({
      'GET /api/v1/nodes': nodes(makeNode()),
      'GET /api/v1/nodes/node-1/metrics?last=24h': () => jsonResponse(aggResponse([])),
    })
    renderPage('/nodes/node-1?range=24h')

    expect(await screen.findByText('Bu aralıkta ölçüm yok.')).toBeInTheDocument()
    expect(screen.getByText(/dakikalık özetten okunur/)).toBeInTheDocument()
  })

  it('listede olmayan kimlik için "bulunamadı" gösterir ve geçmiş istemez', async () => {
    const { calls } = stubFetch({ 'GET /api/v1/nodes': nodes(makeNode({ id: 'baska' })) })
    renderPage('/nodes/yok')

    expect(await screen.findByText('Bu sunucu bulunamadı.')).toBeInTheDocument()
    expect(calls.some((c) => c.path.includes('/metrics'))).toBe(false)
  })

  it('geçmiş isteği başarısız olursa hata ve "Yeniden dene" gösterir; düğme yeniden yükler', async () => {
    let fail = true
    stubFetch({
      'GET /api/v1/nodes': nodes(makeNode()),
      'GET /api/v1/nodes/node-1/metrics?last=15m': () => (fail ? textResponse('bozuk', 500) : raw()),
    })
    renderPage()
    const user = userEvent.setup()

    expect(await screen.findByText(/Ölçümler alınamadı/)).toBeInTheDocument()
    // Sunucu bilgisi (üst kısım) hatadan etkilenmez.
    expect(screen.getByRole('heading', { level: 1, name: 'web-01' })).toBeInTheDocument()

    fail = false
    await user.click(screen.getByRole('button', { name: 'Yeniden dene' }))

    expect(await screen.findAllByTestId('line-canvas')).toHaveLength(2)
  })

  it('liste isteği başarısız olursa hata gösterir', async () => {
    stubFetch({ 'GET /api/v1/nodes': () => textResponse('bozuk', 500) })
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Sunucu listesi alınamadı')
  })

  it('"← Sunucular" bağlantısı listeye döner', async () => {
    stubFetch({
      'GET /api/v1/nodes': nodes(makeNode()),
      'GET /api/v1/nodes/node-1/metrics?last=15m': raw,
    })
    renderPage()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: '← Sunucular' }))
    expect(await screen.findByText('Sunucu listesi sayfası')).toBeInTheDocument()
  })
})
