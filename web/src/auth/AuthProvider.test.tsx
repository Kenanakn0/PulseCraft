import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { apiFetch } from '../api/http'
import { jsonResponse, meResponse, stubFetch, testUser, textResponse } from '../test/fetchStub'
import { AuthProvider } from './AuthProvider'
import { useAuth } from './useAuth'

// A tiny component that renders the provider's state and wires its actions to buttons.
function Probe() {
  const { status, user, sessionExpired, login, logout } = useAuth()
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="user">{user?.display_name ?? '-'}</p>
      <p data-testid="expired">{String(sessionExpired)}</p>
      <button onClick={() => void login('ada@example.test', 'dogru-parola').catch(() => undefined)}>giriş</button>
      <button onClick={() => void logout()}>çıkış</button>
      <button onClick={() => void apiFetch('/api/v1/nodes').catch(() => undefined)}>başka istek</button>
    </div>
  )
}

const renderProbe = () =>
  render(
    <StrictMode>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </StrictMode>,
  )

const expectStatus = (status: string) =>
  waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent(status))

describe('AuthProvider', () => {
  it('açılışta oturum varsa (GET /auth/me 200) authenticated olur', async () => {
    stubFetch({ 'GET /api/v1/auth/me': () => jsonResponse(meResponse) })
    renderProbe()

    expect(screen.getByTestId('status')).toHaveTextContent('loading')
    await expectStatus('authenticated')
    expect(screen.getByTestId('user')).toHaveTextContent('Ada Test')
  })

  it('açılışta oturum yoksa (401) unauthenticated olur; "süresi doldu" işaretlenmez', async () => {
    stubFetch({ 'GET /api/v1/auth/me': () => textResponse('oturum gerekli', 401) })
    renderProbe()

    await expectStatus('unauthenticated')
    expect(screen.getByTestId('expired')).toHaveTextContent('false')
  })

  it('sunucuya ulaşılamazsa unauthenticated olur (giriş ekranı gösterilir)', async () => {
    stubFetch({
      'GET /api/v1/auth/me': () => {
        throw new TypeError('Failed to fetch')
      },
    })
    renderProbe()
    await expectStatus('unauthenticated')
  })

  it('StrictMode\'un çift effect çalıştırması sonucu bozmaz', async () => {
    const { calls } = stubFetch({ 'GET /api/v1/auth/me': () => jsonResponse(meResponse) })
    renderProbe()

    await expectStatus('authenticated')
    // The first effect run is aborted and the second completes: at most two requests.
    expect(calls.filter((c) => c.path === '/api/v1/auth/me').length).toBeLessThanOrEqual(2)
  })

  it('login başarılıysa authenticated olur ve doğru gövdeyi gönderir', async () => {
    const { calls } = stubFetch({
      'GET /api/v1/auth/me': () => textResponse('oturum gerekli', 401),
      'POST /api/v1/auth/login': () => jsonResponse({ user: testUser }),
    })
    renderProbe()
    await expectStatus('unauthenticated')

    await userEvent.setup().click(screen.getByText('giriş'))

    await expectStatus('authenticated')
    expect(calls.find((c) => c.path === '/api/v1/auth/login')?.body).toEqual({
      email: 'ada@example.test',
      password: 'dogru-parola',
    })
  })

  it('login başarısızsa (401) unauthenticated kalır ve "oturum süresi doldu" DEĞİLDİR', async () => {
    stubFetch({
      'GET /api/v1/auth/me': () => textResponse('oturum gerekli', 401),
      'POST /api/v1/auth/login': () => textResponse('geçersiz', 401),
    })
    renderProbe()
    await expectStatus('unauthenticated')

    await userEvent.setup().click(screen.getByText('giriş'))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    expect(screen.getByTestId('expired')).toHaveTextContent('false')
  })

  it('logout: sunucu isteği başarısız olsa bile yerel oturum temizlenir', async () => {
    stubFetch({
      'GET /api/v1/auth/me': () => jsonResponse(meResponse),
      'POST /api/v1/auth/logout': () => textResponse('sunucu hatası', 500),
    })
    renderProbe()
    await expectStatus('authenticated')

    await userEvent.setup().click(screen.getByText('çıkış'))

    await expectStatus('unauthenticated')
    expect(screen.getByTestId('user')).toHaveTextContent('-')
  })

  it('oturum açıkken başka bir istek 401 alırsa oturum "süresi doldu" olarak biter', async () => {
    stubFetch({
      'GET /api/v1/auth/me': () => jsonResponse(meResponse),
      'GET /api/v1/nodes': () => textResponse('oturum gerekli', 401),
    })
    renderProbe()
    await expectStatus('authenticated')

    await userEvent.setup().click(screen.getByText('başka istek'))

    await expectStatus('unauthenticated')
    expect(screen.getByTestId('expired')).toHaveTextContent('true')
  })
})
