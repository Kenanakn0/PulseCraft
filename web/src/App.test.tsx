import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import App from './App'
import { apiFetch } from './api/http'
import { AuthProvider } from './auth/AuthProvider'
import { jsonResponse, meResponse, stubFetch, testUser, textResponse } from './test/fetchStub'

// Adres çubuğunun karşılığı: testte hangi yolda olduğumuzu görmek için.
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

// Panel açılınca GET /nodes çağırdığı için varsayılan olarak boş liste döner; test isterse ezer.
const stub = (routes: Parameters<typeof stubFetch>[0]) =>
  stubFetch({ 'GET /api/v1/nodes': () => jsonResponse([]), ...routes })

describe('uygulama akışı', () => {
  it('oturum kontrolü sürerken "Yükleniyor…" gösterir', async () => {
    stub({ 'GET /api/v1/auth/me': () => new Promise<Response>(() => undefined) }) // hiç yanıtlanmaz
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
    // /login'e "önceki adres" bilgisiyle gelinmiş gibi (RequireAuth'un yaptığı gibi).
    renderApp([{ pathname: '/login', state: { from: '/bilinmeyen/sayfa' } }])
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('E-posta'), 'ada@example.test')
    await user.type(screen.getByLabelText('Parola'), 'dogru-parola')
    await user.click(screen.getByRole('button', { name: 'Giriş yap' }))

    // /bilinmeyen/sayfa tanımlı olmadığı için "*" kuralı "/"e düşürür; önemli olan giriş sayfasında kalmamaktır.
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
    await screen.findByText('Henüz kayıtlı sunucu yok.') // panel tamamen yüklendi (yükleme durumu geçti)

    expired = true // token bu arada sona erdi
    await apiFetch('/api/v1/nodes').catch(() => undefined) // uygulamanın herhangi bir yerindeki istek

    expect(await screen.findByText(/Oturumunuzun süresi doldu/)).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/login')
  })
})
