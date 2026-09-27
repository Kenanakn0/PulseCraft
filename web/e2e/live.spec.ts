import { execFileSync } from 'node:child_process'
import { request, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { USER1_STATE } from './auth-state'
import { expect, test } from './fixtures'

const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD
// İsteğe bağlı: server container'ı. Verilirse "server yeniden başlayınca canlı akış geri gelir" senaryosu çalışır.
const serverContainer = process.env.E2E_SERVER_CONTAINER

// Oturum: setup projesinin bir kez yazdığı çerez (kendi girişimizi yapmayız; bkz. e2e/auth-state.ts).
const storageState = USER1_STATE

const uniqueName = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`

async function withSession(browser: Browser, baseURL: string | undefined) {
  const api = await request.newContext({ baseURL, storageState })
  const context = await browser.newContext({ baseURL, storageState })
  return { api, context }
}

/** Node oluşturur; `post(cpu)` o an için tek ölçüm gönderir (agent gibi, API key ile). */
async function createNode(api: APIRequestContext, name: string) {
  const created = await api.post('/api/v1/nodes', { data: { name } })
  expect(created.status(), 'node oluşturma').toBe(201)
  const { id, api_key: apiKey } = (await created.json()) as { id: string; api_key: string }

  const post = async (cpu: number, at = Date.now()) => {
    const res = await api.post('/api/v1/metrics', {
      headers: { Authorization: `Bearer ${apiKey}` },
      data: {
        samples: [
          {
            time: new Date(at).toISOString(),
            cpu_percent: cpu,
            mem_percent: 40,
            mem_used_bytes: 1,
            disk_percent: 50,
            net_rx_bps: 1000,
            net_tx_bps: 500,
            load1: null,
          },
        ],
      },
    })
    expect(res.status(), 'ölçüm gönderme').toBe(202)
  }
  return { id, name, post }
}

/**
 * REST yanıtını DONDURUR: ilk yanıt gerçekten alınır, sonrakilere aynısı verilir. Böylece 10 sn'lik
 * yoklama ekrandaki değeri güncelleyemez; bir değişiklik görünürse ancak WebSocket'ten gelmiş olabilir.
 */
async function freezeRest(page: Page, urlGlob: string) {
  let frozen: { status: number; body: string } | undefined
  await page.route(urlGlob, async (route) => {
    if (frozen === undefined) {
      const response = await route.fetch()
      frozen = { status: response.status(), body: await response.text() }
    }
    await route.fulfill({ status: frozen.status, contentType: 'application/json', body: frozen.body })
  })
}

test.describe('canlı akış (gerçek tarayıcı + gerçek WebSocket)', () => {
  test.skip(!email || !password, 'E2E_EMAIL ve E2E_PASSWORD tanımlı değil')

  test('sunucu listesi: yeni ölçüm, yoklama beklenmeden (REST dondurulmuşken) karta yansır', async ({
    browser,
    baseURL,
  }) => {
    const { api, context } = await withSession(browser, baseURL)
    const node = await createNode(api, uniqueName('e2e-canli'))
    await node.post(10)

    const page = await context.newPage()
    await freezeRest(page, '**/api/v1/nodes')
    await page.goto('/')

    const card = page.getByTestId('node-card').filter({ hasText: node.name })
    await expect(card.getByText('10,0 %')).toBeVisible()
    await expect(page.getByTestId('live-status')).toHaveText('Canlı')

    await node.post(55.5)
    await expect(card.getByText('55,5 %')).toBeVisible({ timeout: 3000 }) // yoklama dondurulmuş: yalnızca WS

    await context.close()
    await api.dispose()
  })

  test('detay: gösterge ve grafik noktası canlı güncellenir', async ({ browser, baseURL }) => {
    const { api, context } = await withSession(browser, baseURL)
    const node = await createNode(api, uniqueName('e2e-canli-detay'))
    const now = Date.now()
    for (let i = 5; i >= 1; i--) await node.post(20 + i, now - i * 3000)

    const page = await context.newPage()
    await freezeRest(page, '**/api/v1/nodes')
    await freezeRest(page, '**/api/v1/nodes/*/metrics?last=15m')
    await page.goto(`/nodes/${node.id}`)

    await expect(page.getByText(/ham ölçümler · 5 nokta/)).toBeVisible()
    await expect(page.getByTestId('live-status')).toHaveText('Canlı')

    await node.post(91.5)

    await expect(page.getByTestId('gauge-CPU')).toContainText('91,5 %', { timeout: 3000 })
    await expect(page.getByText(/ham ölçümler · 6 nokta/)).toBeVisible({ timeout: 3000 })

    // Canvas gerçekten yeniden çizildi mi (boş değil)?
    const painted = await page.locator('.chart-box canvas').first().evaluate((el) => {
      const c = el as HTMLCanvasElement
      const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
      let n = 0
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) n++
      return n
    })
    expect(painted).toBeGreaterThan(500)

    await context.close()
    await api.dispose()
  })

  test('başka yerden çıkış yapılınca (jti iptali) sunucu WS\'i 4401 ile kapatır: giriş ekranına dönülür', async ({
    browser,
    baseURL,
  }) => {
    // Bu test kendi oturumunu açar: paylaşılan oturumu iptal edip diğer testleri bozmasın.
    const login = await request.newContext({ baseURL })
    const res = await login.post('/api/v1/auth/login', { data: { email, password } })
    expect(res.ok()).toBe(true)
    const ownState = await login.storageState()
    const context = await browser.newContext({ baseURL, storageState: ownState })

    const page = await context.newPage()
    await page.goto('/')
    await expect(page.getByTestId('live-status')).toHaveText('Canlı')

    await login.post('/api/v1/auth/logout') // aynı token iptal edilir; tarayıcıdaki cookie artık geçersiz

    await expect(page).toHaveURL(/\/login/, { timeout: 5000 })

    // Yeniden bağlanma denemesi OLMADI: kısa süre bekleyip giriş sayfasında kaldığını doğrula.
    await page.waitForTimeout(2500)
    await expect(page).toHaveURL(/\/login/)

    await context.close()
    await login.dispose()
  })

  test('server yeniden başlayınca bağlantı otomatik geri gelir ve canlı akış sürer', async ({ browser, baseURL }) => {
    test.skip(!serverContainer, 'E2E_SERVER_CONTAINER tanımlı değil')
    test.setTimeout(90_000)

    const { api, context } = await withSession(browser, baseURL)
    const node = await createNode(api, uniqueName('e2e-yenidenbaglan'))
    await node.post(10)

    const page = await context.newPage()
    await freezeRest(page, '**/api/v1/nodes')
    await page.goto('/')
    const card = page.getByTestId('node-card').filter({ hasText: node.name })
    await expect(card.getByText('10,0 %')).toBeVisible()
    await expect(page.getByTestId('live-status')).toHaveText('Canlı')

    execFileSync('docker', ['restart', serverContainer as string])

    await expect(page.getByTestId('live-status')).toHaveText('Yeniden bağlanıyor…', { timeout: 15_000 })
    await expect(page.getByTestId('live-status')).toHaveText('Canlı', { timeout: 45_000 })
    await expect(page).not.toHaveURL(/\/login/) // oturum (JWT) restart'tan etkilenmez

    await node.post(66.5)
    await expect(card.getByText('66,5 %')).toBeVisible({ timeout: 3000 })

    await context.close()
    await api.dispose()
  })
})
