import { expect, test, type Page } from '@playwright/test'

const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD

/** Sayfada CSP ihlali ve konsol hatası toplar. Boş kalması gerekir. */
async function watchProblems(page: Page) {
  const problems: string[] = []
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP ihlali: ${e.violatedDirective} -> ${e.blockedURI}`)
    })
  })
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    // Oturumsuzken uygulama açılışta GET /auth/me sorar ve 401 alır: TASARIM GEREĞİ; tarayıcı bunu
    // konsola "Failed to load resource" diye yazar. Yalnızca o adres için yok sayılır, başka 401 sayılır.
    if (msg.text().includes('status of 401') && msg.location().url.endsWith('/api/v1/auth/me')) return
    problems.push(`console.error: ${msg.text()} (${msg.location().url})`)
  })
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`))
  return problems
}

async function paintedPixels(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const c = el as HTMLCanvasElement
      const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
      let n = 0
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) n++
      return n
    })
}

test.describe('duman testi: derlenmiş uygulama + nginx + server', () => {
  test('ana sayfa: giriş ekranı, güvenlik başlıkları, CSP gerçekten uygulanıyor, konsol hatası YOK', async ({
    page,
    request,
  }) => {
    const problems = await watchProblems(page)
    const response = await page.goto('/')
    expect(response?.status()).toBe(200)
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('button', { name: /giriş/i })).toBeVisible()

    const h = response!.headers()
    expect(h['content-security-policy']).toContain("default-src 'self'")
    expect(h['content-security-policy']).toContain("script-src 'self'")
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(h['x-content-type-options']).toBe('nosniff')
    expect(h['x-frame-options']).toBe('DENY')
    expect(h['referrer-policy']).toBe('no-referrer')
    expect(h['server'] ?? '').not.toMatch(/\d/) // sürüm numarası sızmıyor
    expect(h['cache-control']).toMatch(/no-cache|no-store|max-age=0/) // index.html önbelleğe alınmaz

    // Gerçek uygulama sorunsuz yüklendi (henüz kasıtlı ihlal yapılmadı).
    expect(problems).toEqual([])

    // CSP'nin GERÇEKTEN uygulandığının kanıtı: satır içi betik çalışmamalı.
    await page.evaluate(() => {
      const s = document.createElement('script')
      s.textContent = 'window.__inlineRan = true'
      document.head.appendChild(s)
    })
    expect(await page.evaluate(() => (window as unknown as { __inlineRan?: boolean }).__inlineRan)).toBeUndefined()

    // Oturumsuz API 401 (nginx → server)
    expect((await request.get('/api/v1/nodes')).status()).toBe(401)
  })

  test('varlıklar: içerik özetli dosya 1 yıl önbelleğe alınır ve gzip olur; olmayan varlık 404', async ({
    page,
    request,
  }) => {
    await page.goto('/login')
    const assets = await page.evaluate(() =>
      [...document.querySelectorAll('script[src], link[rel="stylesheet"][href]')].map(
        (el) => el.getAttribute('src') ?? el.getAttribute('href') ?? '',
      ),
    )
    const js = assets.find((a) => a.startsWith('/assets/') && a.endsWith('.js'))
    expect(js, 'derlenmiş .js bulunamadı').toBeDefined()

    const res = await request.get(js!, { headers: { 'Accept-Encoding': 'gzip' } })
    expect(res.status()).toBe(200)
    expect(res.headers()['cache-control']).toContain('max-age=31536000')
    expect(res.headers()['content-encoding']).toBe('gzip')
    // add_header miras kaybı yok: bu location'da da güvenlik başlıkları duruyor.
    expect(res.headers()['content-security-policy']).toContain("default-src 'self'")

    expect((await request.get('/assets/yok-boyle-dosya.js')).status()).toBe(404)
  })

  test.describe('giriş yapılmış akış', () => {
    test.skip(!email || !password, 'E2E_EMAIL ve E2E_PASSWORD tanımlı değil')

    test('giriş → canlı bağlantı (WS nginx üzerinden) → kart → detay grafikleri; CSP ihlali YOK; derin bağlantı yenilenir', async ({
      page,
      request,
    }) => {
      const problems = await watchProblems(page)

      await page.goto('/login')
      await page.getByLabel('E-posta').fill(email!)
      await page.getByLabel('Parola').fill(password!)
      await page.getByRole('button', { name: /giriş/i }).click()
      await expect(page.getByTestId('current-user')).toBeVisible()
      await expect(page.getByTestId('live-status')).toHaveText('Canlı')

      // Bir node + ölçümler (agent gibi). node oluşturma oturum ister: tarayıcının çerezini API'ye de veriyoruz.
      const cookies = await page.context().cookies()
      const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
      const name = `smoke-${Math.random().toString(36).slice(2, 8)}`
      const created = await request.post('/api/v1/nodes', { data: { name }, headers: { Cookie: cookieHeader } })
      expect(created.status()).toBe(201)
      const { id, api_key: apiKey } = (await created.json()) as { id: string; api_key: string }
      const now = Date.now()
      const samples = Array.from({ length: 30 }, (_, i) => ({
        time: new Date(now - (29 - i) * 3000).toISOString(),
        cpu_percent: 40 + 30 * Math.sin(i / 4),
        mem_percent: 55,
        mem_used_bytes: 1,
        disk_percent: 60,
        net_rx_bps: 1000 + i * 10,
        net_tx_bps: 500,
        load1: null,
      }))
      const post = await request.post('/api/v1/metrics', {
        headers: { Authorization: `Bearer ${apiKey}` },
        data: { samples },
      })
      expect(post.status()).toBe(202)

      const card = page.getByTestId('node-card').filter({ hasText: name })
      await expect(card).toBeVisible({ timeout: 15_000 })
      await card.getByRole('link', { name }).click()
      await expect(page).toHaveURL(new RegExp(`/nodes/${id}$`))
      await expect(page.getByText(/ham ölçümler · 30 nokta/)).toBeVisible()
      await expect.poll(() => paintedPixels(page, '.chart-box canvas')).toBeGreaterThan(1000)
      await expect.poll(() => paintedPixels(page, '.gauge-canvas canvas')).toBeGreaterThan(200)

      // Derin bağlantıyı YENİLE: nginx try_files → index.html, React yönlendirici yolu çözer.
      const reloaded = await page.reload()
      expect(reloaded?.status()).toBe(200)
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
      await expect(page.getByTestId('live-status')).toHaveText('Canlı')

      expect(problems, 'CSP ihlali / konsol hatası').toEqual([])
    })
  })
})
