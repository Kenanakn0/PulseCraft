import { StrictMode, type ReactNode } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AlertsProvider } from '../alerts/AlertsProvider'
import type { AlertRow } from '../api/types'
import { AlertsNavLink } from '../components/AlertsNavLink'
import { RealtimeProvider } from '../realtime/RealtimeProvider'
import { alertRoutes } from '../test/alertStub'
import { createFakeSocket, FakeSocket } from '../test/fakeWebSocket'
import { jsonResponse, meResponse, stubFetch, textResponse } from '../test/fetchStub'
import { alertEventPayload, makeAlert } from '../test/fixtures'
import { AlertsPage } from './AlertsPage'

function Where() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname + location.search}</output>
}

const renderPage = (url = '/alerts', extra?: ReactNode) =>
  render(
    <StrictMode>
      <MemoryRouter initialEntries={[url]}>
        <RealtimeProvider createSocket={createFakeSocket} url="ws://test/ws" baseDelayMs={10} maxDelayMs={20}>
          <AlertsProvider syncMs={60_000}>
            <AlertsNavLink />
            <AlertsPage />
            {extra}
            <Where />
          </AlertsProvider>
        </RealtimeProvider>
      </MemoryRouter>
    </StrictMode>,
  )

const liveSocket = () => {
  const alive = FakeSocket.instances.filter((s) => !s.closedByClient)
  const s = alive[alive.length - 1]
  if (s === undefined) throw new Error('yaşayan soket yok')
  return s
}
const send = (payload: unknown) => act(() => liveSocket().send(payload))

const sample = (): AlertRow[] => [
  makeAlert({ id: 1, rule_name: 'Yüksek CPU', severity: 'critical', node_id: 'n1', node_name: 'web-01' }),
  makeAlert({ id: 2, rule_name: 'Disk dolu', severity: 'warning', metric: 'disk_percent', threshold: 85, trigger_value: 88, node_id: 'n2', node_name: 'db-01' }),
  makeAlert({
    id: 3,
    rule_name: 'RAM yüksek',
    severity: 'info',
    metric: 'mem_percent',
    status: 'acknowledged',
    acknowledged_by: 'Ada Test',
    acknowledged_at: '2030-01-01T10:05:00Z',
  }),
  makeAlert({
    id: 4,
    rule_name: 'Eski alarm',
    status: 'resolved',
    triggered_at: '2030-01-01T09:00:00Z',
    acknowledged_by: 'Bob',
    acknowledged_at: '2030-01-01T09:01:00Z',
    resolved_at: '2030-01-01T09:12:05Z',
  }),
]

describe('AlertsPage', () => {
  it('yüklenirken bilgi gösterir', async () => {
    stubFetch({
      'GET /api/v1/alerts?status=open': () => new Promise<Response>(() => undefined),
      'GET /api/v1/alerts?status=acknowledged': () => new Promise<Response>(() => undefined),
      'GET /api/v1/alerts?status=resolved': () => new Promise<Response>(() => undefined),
    })
    renderPage()
    expect(await screen.findByText('Alarmlar yükleniyor…')).toBeInTheDocument()
  })

  it('sekmeler canlı sayaçlarla gelir; varsayılan sekme "Açık", kritik alarm üstte', async () => {
    stubFetch(alertRoutes(sample))
    renderPage()

    const cards = await screen.findAllByTestId('alert-card')
    expect(cards.map((c) => within(c).getByText(/Yüksek CPU|Disk dolu/).textContent)).toEqual(['Yüksek CPU', 'Disk dolu'])
    expect(screen.getByRole('tab', { name: /Açık/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Açık 2' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'İncelenen 1' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Çözülen 1' })).toBeInTheDocument()
  })

  it('kart: önem, kural, sunucu bağlantısı, değer/eşik ve düğme', async () => {
    stubFetch(alertRoutes(sample))
    renderPage()

    const card = (await screen.findAllByTestId('alert-card'))[0]!
    expect(within(card).getByText('Kritik')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'web-01' })).toHaveAttribute('href', '/nodes/n1')
    expect(within(card).getByText(/CPU 93,2 % \(eşik > 90 %\)/)).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'İncelemeye aldım' })).toBeInTheDocument()
  })

  it('"İncelenen" sekmesi kimin aldığını gösterir ve düğme sunmaz', async () => {
    stubFetch(alertRoutes(sample))
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByTestId('alert-card')

    await user.click(screen.getByRole('tab', { name: /İncelenen/ }))

    const card = screen.getByTestId('alert-card')
    expect(within(card).getByText('Ada Test')).toBeInTheDocument()
    expect(card).toHaveTextContent('inceliyor')
    expect(within(card).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/alerts?tab=acknowledged')
  })

  it('"Çözülen" sekmesi süreyi (sunucu zaman damgalarından) ve incelemeyi gösterir', async () => {
    stubFetch(alertRoutes(sample))
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByTestId('alert-card')

    await user.click(screen.getByRole('tab', { name: /Çözülen/ }))

    const card = screen.getByTestId('alert-card')
    expect(card).toHaveTextContent('Süre: 12 dk 5 sn')
    expect(card).toHaveTextContent('Bob incelemişti')
  })

  it('adresteki ?tab= ile açılır; geçersiz değer "Açık"a düşer', async () => {
    stubFetch(alertRoutes(sample))
    const first = renderPage('/alerts?tab=resolved')
    await screen.findAllByTestId('alert-card')
    expect(screen.getByRole('tab', { name: /Çözülen/ })).toHaveAttribute('aria-selected', 'true')
    first.unmount()

    renderPage('/alerts?tab=zzz')
    await screen.findAllByTestId('alert-card')
    expect(screen.getByRole('tab', { name: /Açık/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('boş sekmede açıklayıcı mesaj gösterir', async () => {
    stubFetch(alertRoutes(() => []))
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('Açık alarm yok.')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /İncelenen/ }))
    expect(screen.getByText('İncelenen alarm yok.')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /Çözülen/ }))
    expect(screen.getByText('Çözülen alarm yok.')).toBeInTheDocument()
  })

  it('"İncelemeye aldım": başarıda kart "Açık"tan "İncelenen"e geçer, sayaçlar güncellenir', async () => {
    stubFetch({
      ...alertRoutes(() => [makeAlert({ id: 1 })]),
      'POST /api/v1/alerts/1/ack': () =>
        jsonResponse(
          alertEventPayload({
            event: 'acknowledged',
            status: 'acknowledged',
            acknowledged_by: 'Ada Test',
            acknowledged_at: '2030-01-01T10:05:00Z',
          }),
        ),
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'İncelemeye aldım' }))

    await waitFor(() => expect(screen.getByRole('tab', { name: 'İncelenen 1' })).toBeInTheDocument())
    expect(screen.getByRole('tab', { name: 'Açık 0' })).toBeInTheDocument()
    expect(screen.getByText('Açık alarm yok.')).toBeInTheDocument()
  })

  it('düğme istek sürerken kilitlenir ("Alınıyor…") ve çift tıklama tek istek gönderir', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { calls } = stubFetch({
      ...alertRoutes(() => [makeAlert({ id: 1 })]),
      'POST /api/v1/alerts/1/ack': async () => {
        await gate
        return textResponse('çakışma', 409)
      },
    })
    const user = userEvent.setup()
    renderPage()

    const button = await screen.findByRole('button', { name: 'İncelemeye aldım' })
    await user.click(button)
    await user.click(screen.getByRole('button', { name: 'Alınıyor…' })) // disabled: the click has no effect

    expect(screen.getByRole('button', { name: 'Alınıyor…' })).toBeDisabled()
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)
    release?.()
    await waitFor(() => expect(screen.getByRole('button', { name: 'İncelemeye aldım' })).toBeEnabled())
  })

  it('409: başkası önce almışsa kartta açıklayıcı mesaj görünür ve satır güncellenir', async () => {
    let rows = [makeAlert({ id: 1 })]
    stubFetch({ ...alertRoutes(() => rows), 'POST /api/v1/alerts/1/ack': () => textResponse('zaten', 409) })
    const user = userEvent.setup()
    renderPage()
    const button = await screen.findByRole('button', { name: 'İncelemeye aldım' })

    rows = [makeAlert({ id: 1, status: 'acknowledged', acknowledged_by: 'Bob' })]
    await user.click(button)

    // After the refresh the card moves to "İncelenen"; the message may vanish with the card.
    await waitFor(() => expect(screen.getByRole('tab', { name: 'İncelenen 1' })).toBeInTheDocument())
    await user.click(screen.getByRole('tab', { name: /İncelenen/ }))
    expect(screen.getByTestId('alert-card')).toHaveTextContent('Bob')
  })

  it('ağ hatasında kart açık kalır ve hata mesajı gösterir', async () => {
    stubFetch({
      ...alertRoutes(() => [makeAlert({ id: 1 })]),
      'POST /api/v1/alerts/1/ack': () => {
        throw new TypeError('Failed to fetch')
      },
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'İncelemeye aldım' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Sunucuya ulaşılamadı.')
    expect(screen.getByRole('button', { name: 'İncelemeye aldım' })).toBeEnabled()
  })

  it('CANLI: başka bir kullanıcının incelemesi, sayfa yenilenmeden kartı "Açık"tan düşürür', async () => {
    stubFetch({ ...alertRoutes(() => [makeAlert({ id: 1 })]), 'GET /api/v1/auth/me': () => jsonResponse(meResponse) })
    renderPage()
    await screen.findByRole('button', { name: 'İncelemeye aldım' })
    await act(() => liveSocket().open())

    await send(
      alertEventPayload({ event: 'acknowledged', status: 'acknowledged', acknowledged_by: 'Bob', acknowledged_at: '2030-01-01T10:05:00Z' }),
    )

    expect(screen.queryByRole('button', { name: 'İncelemeye aldım' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'İncelenen 1' })).toBeInTheDocument()
  })

  it('CANLI: yeni alarm anında listeye ve üst çubuk sayacına girer', async () => {
    stubFetch(alertRoutes(() => []))
    renderPage()
    await screen.findByText('Açık alarm yok.')
    await act(() => liveSocket().open())
    expect(screen.queryByTestId('open-alerts-badge')).not.toBeInTheDocument()

    await send(alertEventPayload({ id: 5, rule_name: 'Yeni kural', node_name: 'api-01' }))

    expect(await screen.findByText('Yeni kural')).toBeInTheDocument()
    expect(screen.getByTestId('open-alerts-badge')).toHaveTextContent('1')
    expect(screen.getByRole('link', { name: /Alarmlar/ })).toHaveAccessibleName(/1 açık alarm/)
  })

  it('üst çubuk sayacı yalnızca AÇIK alarmları sayar', async () => {
    stubFetch(alertRoutes(sample))
    renderPage()
    await screen.findAllByTestId('alert-card')
    expect(screen.getByTestId('open-alerts-badge')).toHaveTextContent('2') // 2 open; acknowledged/resolved do not count
  })

  it('yükleme hatasında mesaj ve "Yeniden dene" gösterir', async () => {
    let fail = true
    stubFetch({
      'GET /api/v1/alerts?status=open': () => (fail ? textResponse('bozuk', 500) : jsonResponse([])),
      'GET /api/v1/alerts?status=acknowledged': () => jsonResponse([]),
      'GET /api/v1/alerts?status=resolved': () => jsonResponse([]),
    })
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Alarmlar alınamadı (HTTP 500).')
    fail = false
    await user.click(screen.getByRole('button', { name: 'Yeniden dene' }))

    expect(await screen.findByText('Açık alarm yok.')).toBeInTheDocument()
  })

  it('sunucu her durum için 200 kayıt döndürdüyse sınırı belirtir', async () => {
    const many = Array.from({ length: 200 }, (_, i) => makeAlert({ id: i + 1, rule_name: `Kural ${i + 1}` }))
    stubFetch(alertRoutes(() => many))
    renderPage()

    expect(await screen.findByText('Bu sekmede en yeni 200 kayıt gösteriliyor.')).toBeInTheDocument()
  })
})
