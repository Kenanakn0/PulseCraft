import { execFileSync } from 'node:child_process'
import { request, type APIRequestContext, type Browser, type Locator } from '@playwright/test'
import { USER1_STATE } from './auth-state'
import { expect, test } from './fixtures'

const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD
// Optional: the throw-away stack's database container. When set, past samples are pushed into the
// 1-minute aggregate immediately instead of waiting for its own schedule.
const dbContainer = process.env.E2E_DB_CONTAINER
const dbUser = process.env.E2E_DB_USER ?? 'postgres'
const dbName = process.env.E2E_DB_NAME ?? 'postgres'

const shot = (name: string) => `e2e/screenshots/${name}.png`

// Session: the cookie written once by the setup project (see e2e/auth-state.ts).
const storageState = USER1_STATE

const uniqueName = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`

async function withSession(browser: Browser, baseURL: string | undefined) {
  const api = await request.newContext({ baseURL, storageState })
  const context = await browser.newContext({ baseURL, storageState })
  return { api, context }
}

/** Creates a node and posts `count` sine-shaped samples spread over the last `minutes` minutes. */
async function seedNode(api: APIRequestContext, name: string, minutes: number, count: number) {
  const created = await api.post('/api/v1/nodes', { data: { name } })
  expect(created.status(), 'node oluşturma').toBe(201)
  const { id, api_key: apiKey } = (await created.json()) as { id: string; api_key: string }

  const now = Date.now()
  const samples = Array.from({ length: count }, (_, i) => {
    const t = now - ((count - 1 - i) * minutes * 60_000) / Math.max(count - 1, 1)
    const wave = Math.sin(i / 4)
    return {
      time: new Date(t).toISOString(),
      cpu_percent: 50 + 40 * wave,
      mem_percent: 60 + 10 * Math.cos(i / 5),
      mem_used_bytes: 1_000_000,
      disk_percent: 70,
      net_rx_bps: Math.round(200_000 + 150_000 * wave),
      net_tx_bps: Math.round(50_000 + 20_000 * Math.cos(i / 3)),
      load1: null,
    }
  })
  const res = await api.post('/api/v1/metrics', { headers: { Authorization: `Bearer ${apiKey}` }, data: { samples } })
  expect(res.status(), 'ölçüm gönderme').toBe(202)
  return { id, name }
}

function refreshAggregate() {
  if (!dbContainer) return
  execFileSync('docker', [
    'exec', dbContainer, 'psql', '-U', dbUser, '-d', dbName, '-c',
    "CALL refresh_continuous_aggregate('metrics_1m', NULL, NULL);",
  ])
}

/** Whether the canvas actually drew something: the number of non-transparent pixels. */
async function paintedPixels(canvas: Locator): Promise<number> {
  return canvas.evaluate((el) => {
    const c = el as HTMLCanvasElement
    const ctx = c.getContext('2d')
    if (!ctx || c.width === 0 || c.height === 0) return 0
    const { data } = ctx.getImageData(0, 0, c.width, c.height)
    let n = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) n++
    return n
  })
}

test.describe('sunucu detayı (gerçek tarayıcı + gerçek arka uç)', () => {
  test.skip(!email || !password, 'E2E_EMAIL ve E2E_PASSWORD tanımlı değil')

  test('karttan detaya gidilir; göstergeler ve grafikler GERÇEKTEN çizilir', async ({ browser, baseURL }) => {
    const { api, context } = await withSession(browser, baseURL)
    const node = await seedNode(api, uniqueName('e2e-detay'), 10, 60)

    const page = await context.newPage()
    await page.goto('/')
    await page.getByTestId('node-card').filter({ hasText: node.name }).getByRole('link', { name: node.name }).click()

    await expect(page).toHaveURL(new RegExp(`/nodes/${node.id}$`))
    await expect(page.getByRole('heading', { level: 1, name: node.name })).toBeVisible()
    await expect(page.getByText('Çevrimiçi')).toBeVisible()

    await expect(page.getByTestId('gauge-Disk')).toContainText('70,0 %')
    for (const label of ['CPU', 'RAM', 'Disk']) {
      const canvas = page.getByTestId(`gauge-${label}`).locator('canvas')
      await expect.poll(() => paintedPixels(canvas), { message: `${label} göstergesi çizildi` }).toBeGreaterThan(200)
    }

    await expect(page.getByText(/ham ölçümler · 60 nokta/)).toBeVisible()
    const charts = page.locator('.chart-box canvas')
    await expect(charts).toHaveCount(2)
    for (const i of [0, 1]) {
      await expect.poll(() => paintedPixels(charts.nth(i)), { message: `grafik ${i} çizildi` }).toBeGreaterThan(1000)
    }
    await page.screenshot({ path: shot('20-detay-15dk'), fullPage: true })

    await context.close()
    await api.dispose()
  })

  test('aralık değişince sunucudan o pencere istenir (6 sa → dakikalık özet), adres güncellenir', async ({
    browser,
    baseURL,
  }) => {
    const { api, context } = await withSession(browser, baseURL)
    const node = await seedNode(api, uniqueName('e2e-aralik'), 30, 90)
    refreshAggregate()

    const page = await context.newPage()
    const requested: string[] = []
    page.on('request', (r) => {
      const u = new URL(r.url())
      if (u.pathname.endsWith('/metrics') && u.pathname.includes(node.id)) requested.push(u.search)
    })

    await page.goto(`/nodes/${node.id}`)
    await expect(page.getByText(/ham ölçümler/)).toBeVisible()

    await page.getByRole('button', { name: '6 sa' }).click()
    await expect(page).toHaveURL(/range=6h/)
    await expect.poll(() => requested).toContain('?last=6h')

    if (dbContainer) {
      await expect(page.getByText(/dakikalık ortalama/)).toBeVisible()
      const charts = page.locator('.chart-box canvas')
      await expect(charts).toHaveCount(2)
      await expect.poll(() => paintedPixels(charts.first())).toBeGreaterThan(500)
      await page.screenshot({ path: shot('21-detay-6sa'), fullPage: true })
    } else {
      // If the aggregate has no data yet, the app must say so (not crash).
      await expect(page.getByText(/dakikalık ortalama|Bu aralıkta ölçüm yok/)).toBeVisible()
    }

    // Reloading shows the same view (the range lives in the URL).
    await page.reload()
    await expect(page.getByRole('button', { name: '6 sa' })).toHaveAttribute('aria-pressed', 'true')

    await context.close()
    await api.dispose()
  })

  test('tarayıcı saati 3 gün ileride olsa da grafik penceresi ve veri doğru gelir', async ({ browser, baseURL }) => {
    const { api, context } = await withSession(browser, baseURL)
    const node = await seedNode(api, uniqueName('e2e-saat'), 10, 40)

    const page = await context.newPage()
    await page.clock.setFixedTime(new Date(Date.now() + 3 * 24 * 3600 * 1000))
    await page.goto(`/nodes/${node.id}`)

    const browserNow = await page.evaluate(() => Date.now())
    expect(browserNow - Date.now()).toBeGreaterThan(2 * 24 * 3600 * 1000) // precondition: the clock really is ahead

    await expect(page.getByText('Çevrimiçi')).toBeVisible()
    await expect(page.getByText(/ham ölçümler · 40 nokta/)).toBeVisible()
    const chart = page.locator('.chart-box canvas').first()
    await expect.poll(() => paintedPixels(chart)).toBeGreaterThan(1000)

    await context.close()
    await api.dispose()
  })

  test('hiç ölçümü olmayan sunucu ve olmayan kimlik zarifçe işlenir', async ({ browser, baseURL }) => {
    const { api, context } = await withSession(browser, baseURL)
    const created = await api.post('/api/v1/nodes', { data: { name: uniqueName('e2e-bos') } })
    const { id } = (await created.json()) as { id: string }

    const page = await context.newPage()
    await page.goto(`/nodes/${id}`)
    await expect(page.getByText('Bu aralıkta ölçüm yok.')).toBeVisible()
    await expect(page.getByTestId('gauge-CPU')).toContainText('—')

    await page.goto('/nodes/00000000-0000-0000-0000-000000000000')
    await expect(page.getByText('Bu sunucu bulunamadı.')).toBeVisible()

    // Malformed id: the server answers 400 and the UI says "not found" (no crash).
    await page.goto('/nodes/gecersiz-kimlik')
    await expect(page.getByText('Bu sunucu bulunamadı.')).toBeVisible()

    await context.close()
    await api.dispose()
  })
})
