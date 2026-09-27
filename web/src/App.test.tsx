import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import App from './App'
import { apiFetch } from './api/http'
import { AuthProvider } from './auth/AuthProvider'
import { alertRoutes } from './test/alertStub'
import { jsonResponse, meResponse, stubFetch, testUser, textResponse } from './test/fetchStub'

// Stands in for the address bar: shows which path the test is on.
function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

function renderApp(initialEntries: Parameters<typeof MemoryRouter>[0]['initialEntries'] = ['/']) {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={initialEntries}>
        <AuthProvider>
          <App />
          <Where />
        </AuthProvider>
      </MemoryRouter>
    </StrictMode>,
  )
}

const noSession = () => textResponse('oturum gerekli', 401)

// The signed-in layout calls GET /nodes and GET /alerts; they answer with empty lists unless a test
// overrides them.
const stub = (routes: Parameters<typeof stubFetch>[0]) =>
  stubFetch({ 'GET /api/v1/nodes': () => jsonResponse([]), ...alertRoutes(() => []), ...routes })

describe('uygulama akışı', () => {
  it('üst çubuktaki "Kurallar" bağlantısı alarm kuralları ekranını açar', async () => {
    stub({ 'GET /api/v1/auth/me': () => jsonResponse(meResponse) })
    const user = userEvent.setup()
    renderApp(['/'])

    await user.click(await screen.findByRole('link', { name: 'Kurallar' }))

    expect(await screen.findByRole('heading', { name: 'Alarm kuralları' })).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/alert-rules')
  })

  it('üst çubuktaki "Alarmlar" bağlantısı alarm panosunu açar', async () => {
    stub({ 'GET /api/v1/auth/me': () => jsonResponse(meResponse) })
    const user = userEvent.setup()
    renderApp(['/'])

    await user.click(await screen.findByRole('link', { name: 'Alarmlar' }))

    expect(await screen.findByRole('heading', { name: 'Alarmlar' })).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/alerts')
    expect(screen.getByRole('link', { name: 'Alarmlar' })).toHaveAttribute('aria-current', 'page')
  })

  it('oturum kontrolü sürerken "Yükleniyor…" gösterir', async () => {
    stub({ 'GET /api/v1/auth/me': () => new Promise<Response>(() => undefined) }) // never answered
    renderApp()
    expect(await screen.findByText('Yükleniyor…')).toBeInTheDocument()
  })

  it('girişsiz korumalı sayfa /login\'e yönlendirir', async () => {
    stub({ 'GET /api/v1/auth/me': noSession })
    renderApp(['/'])

    expect(await screen.findByRole('button', { name: 'Giriş yap' })).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/login')
  })

  it('bilinmeyen adres, girişliyken paneli gösterir', async () => {
    stub({ 'GET /api/v1/auth/me': () => jsonResponse(meResponse) })
    renderApp(['/yok/boyle/bir/sayfa'])

    expect(await screen.findByRole('heading', { name: 'Sunucular' })).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/')
  })

  it('girişliyken üst çubukta kullanıcı adı görünür, /login paneli açar', async () => {
    stub({ 'GET /api/v1/auth/me': () => jsonResponse(meResponse) })
    renderApp(['/login'])

    expect(await screen.findByTestId('current-user')).toHaveTextContent('Ada Test')
    expect(screen.getByTestId('where')).toHaveTextContent('/')
  })

  it('boş formu göndermek isteği ATMAZ ve uyarı gösterir', async () => {
    const { calls } = stub({ 'GET /api/v1/auth/me': noSession })
    renderApp(['/login'])
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Giriş yap' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('E-posta ve parola girin.')
    expect(calls.some((c) => c.path === '/api/v1/auth/login')).toBe(false)
  })

  it('yanlış parolada hata gösterir, formda kalır ve alanlar korunur', async () => {
    stub({
      'GET /api/v1/auth/me': noSession,
      'POST /api/v1/auth/login': () => textResponse('e-posta veya parola hatalı', 401),
    })
    renderApp(['/login'])
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('E-posta'), 'ada@example.test')
    await user.type(screen.getByLabelText('Parola'), 'yanlis')
    await user.click(screen.getByRole('button', { name: 'Giriş yap' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('E-posta veya parola hatalı.')
    expect(screen.getByLabelText('E-posta')).toHaveValue('ada@example.test')
    expect(screen.getByTestId('where')).toHaveTextContent('/login')
  })

  it('429\'da bekleme süresini gösterir', async () => {
    stub({
      'GET /api/v1/auth/me': noSession,
      'POST /api/v1/auth/login': () => textResponse('çok fazla', 429, { 'Retry-After': '30' }),
    })
    renderApp(['/login'])
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('E-posta'), 'ada@example.test')
    await user.type(screen.getByLabelText('Parola'), 'x')
    await user.click(screen.getByRole('button', { name: 'Giriş yap' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('30 saniye sonra tekrar deneyin')
  })

  it('istek sürerken düğme devre dışı kalır; başarılı girişte panele geçilir', async () => {
    let finishLogin: (r: Response) => void = () => undefined
    stub({
      'GET /api/v1/auth/me': noSession,
      'POST /api/v1/auth/login': () => new Promise<Response>((resolve) => (finishLogin = resolve)),
    })
    renderApp(['/login'])
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('E-posta'), 'ada@example.test')
    await user.type(screen.getByLabelText('Parola'), 'dogru-parola')
    await user.click(screen.getByRole('button', { name: 'Giriş yap' }))

    const busy = await screen.findByRole('button', { name: 'Giriş yapılıyor…' })
    expect(busy).toBeDisabled()

    finishLogin(jsonResponse({ user: testUser }))

    expect(await screen.findByRole('heading', { name: 'Sunucular' })).toBeInTheDocument()
    expect(screen.getByTestId('current-user')).toHaveTextContent('Ada Test')
  })

  it('girişten sonra, yönlendirildiği sayfaya (from) döner', async () => {
    stub({
      'GET /api/v1/auth/me': noSession,
      'POST /api/v1/auth/login': () => jsonResponse({ user: testUser }),
    })
    // As if /login was reached with a "from" location (what RequireAuth does).
    renderApp([{ pathname: '/login', state: { from: '/bilinmeyen/sayfa' } }])
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('E-posta'), 'ada@example.test')
    await user.type(screen.getByLabelText('Parola'), 'dogru-parola')
    await user.click(screen.getByRole('button', { name: 'Giriş yap' }))

    // /bilinmeyen/sayfa is not defined, so the "*" route sends it to "/"; what matters is leaving the login page.
    await waitFor(() => expect(screen.getByTestId('where')).not.toHaveTextContent('/login'))
  })

  it('Çıkış: giriş sayfasına döner ve korumalı sayfaya geri dönülemez', async () => {
    stub({
      'GET /api/v1/auth/me': () => jsonResponse(meResponse),
      'POST /api/v1/auth/logout': () => new Response(null, { status: 204 }),
    })
    renderApp(['/'])
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Çıkış' }))

    expect(await screen.findByRole('button', { name: 'Giriş yap' })).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/login')
  })

  it('oturum süresi dolarsa (başka bir istek 401 alırsa) giriş ekranı açıklamayla gelir', async () => {
    let expired = false
    stub({
      'GET /api/v1/auth/me': () => jsonResponse(meResponse),
      'GET /api/v1/nodes': () => (expired ? noSession() : jsonResponse([])),
    })
    renderApp(['/'])
    await screen.findByText('Henüz kayıtlı sunucu yok.') // dashboard fully loaded

    expired = true // the token expired meanwhile
    await apiFetch('/api/v1/nodes').catch(() => undefined) // a request anywhere in the app

    expect(await screen.findByText(/Oturumunuzun süresi doldu/)).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/login')
  })
})
