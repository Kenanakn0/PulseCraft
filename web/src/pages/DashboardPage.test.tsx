import { StrictMode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import { jsonResponse, meResponse, stubFetch, textResponse } from '../test/fetchStub'
import { makeNode } from '../test/fixtures'
import { DashboardPage } from './DashboardPage'

const renderDashboard = () =>
  render(
    <StrictMode>
      <MemoryRouter>
        <AuthProvider>
          <DashboardPage />
        </AuthProvider>
      </MemoryRouter>
    </StrictMode>,
  )

const me = () => jsonResponse(meResponse)

describe('DashboardPage', () => {
  it('yüklenirken bilgi gösterir', async () => {
    stubFetch({ 'GET /api/v1/auth/me': me, 'GET /api/v1/nodes': () => new Promise<Response>(() => undefined) })
    renderDashboard()
    expect(await screen.findByText('Sunucular yükleniyor…')).toBeInTheDocument()
  })

  it('sunucuları kart olarak listeler: çevrimiçi olanlar önce, özet sayılarla', async () => {
    stubFetch({
      'GET /api/v1/auth/me': me,
      'GET /api/v1/nodes': () =>
        jsonResponse([
          makeNode({ id: 'a', name: 'db-01', online: false, last_seen_seconds_ago: 600 }),
          makeNode({ id: 'b', name: 'web-01', online: true }),
          makeNode({ id: 'c', name: 'api-01', online: true }),
        ]),
    })
    renderDashboard()

    const cards = await screen.findAllByTestId('node-card')
    expect(cards.map((c) => within(c).getByRole('heading').textContent)).toEqual(['api-01', 'web-01', 'db-01'])
    expect(screen.getByTestId('node-summary')).toHaveTextContent('3 sunucu · 2 çevrimiçi')
  })

  it('"Sunucu ekle" ile eklenen sunucu, anahtar gösterilirken listede belirir', async () => {
    let list = [makeNode({ id: 'a', name: 'db-01' })]
    stubFetch({
      'GET /api/v1/auth/me': me,
      'GET /api/v1/nodes': () => jsonResponse(list),
      'POST /api/v1/nodes': () => {
        list = [...list, makeNode({ id: 'b', name: 'web-01', online: false, latest: null, last_seen_at: null, last_seen_seconds_ago: null })]
        return jsonResponse({ id: 'b', name: 'web-01', api_key: 'f'.repeat(64) }, 201)
      },
    })
    renderDashboard()
    const user = userEvent.setup()
    await screen.findAllByTestId('node-card')

    await user.click(screen.getByRole('button', { name: 'Sunucu ekle' }))
    await user.type(screen.getByLabelText('Sunucu adı'), 'web-01')
    await user.click(screen.getByRole('button', { name: 'Ekle' }))

    expect(await screen.findByLabelText('API anahtarı')).toHaveValue('f'.repeat(64))
    await waitFor(() => expect(screen.getAllByTestId('node-card')).toHaveLength(2))
  })

  it('liste boşsa açıklayıcı boş durum gösterir', async () => {
    stubFetch({ 'GET /api/v1/auth/me': me, 'GET /api/v1/nodes': () => jsonResponse([]) })
    renderDashboard()

    expect(await screen.findByText('Henüz kayıtlı sunucu yok.')).toBeInTheDocument()
    expect(screen.queryByTestId('node-card')).not.toBeInTheDocument()
    expect(screen.getByTestId('node-summary')).toHaveTextContent('0 sunucu · 0 çevrimiçi')
  })

  it('hata durumunda mesaj ve "Yeniden dene" gösterir; düğme listeyi yükler', async () => {
    let fail = true
    stubFetch({
      'GET /api/v1/auth/me': me,
      'GET /api/v1/nodes': () => (fail ? textResponse('bozuk', 500) : jsonResponse([makeNode()])),
    })
    renderDashboard()
    const user = userEvent.setup()

    expect(await screen.findByRole('alert')).toHaveTextContent('Sunucu listesi alınamadı (HTTP 500).')

    fail = false
    await user.click(screen.getByRole('button', { name: 'Yeniden dene' }))

    expect(await screen.findByTestId('node-card')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
