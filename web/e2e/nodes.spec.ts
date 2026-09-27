import { request, type APIRequestContext, type Browser } from '@playwright/test'
import { USER1_STATE } from './auth-state'
import { expect, test } from './fixtures'

const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD

const shot = (name: string) => `e2e/screenshots/${name}.png`

// Session: the cookie written once by the setup project (see e2e/auth-state.ts).
const storageState = USER1_STATE

const uniqueName = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`

interface TestNode {
  id: string
  name: string
  /** Posts one sample for this node (like the agent, with the API key). */
  postSample: (values: { cpu: number; mem: number; disk: number }, hostname?: string) => Promise<void>
}

async function createNode(api: APIRequestContext, name: string): Promise<TestNode> {
  const created = await api.post('/api/v1/nodes', { data: { name } })
  expect(created.status(), 'node oluşturma').toBe(201)
  const { id, api_key: apiKey } = (await created.json()) as { id: string; api_key: string }

  return {
    id,
    name,
    postSample: async ({ cpu, mem, disk }, hostname) => {
      const res = await api.post('/api/v1/metrics', {
        headers: { Authorization: `Bearer ${apiKey}` },
        data: {
          ...(hostname === undefined ? {} : { hostname }),
          samples: [
            {
              time: new Date().toISOString(),
              cpu_percent: cpu,
              mem_percent: mem,
              mem_used_bytes: 1,
              disk_percent: disk,
              net_rx_bps: 0,
              net_tx_bps: 0,
              load1: null,
            },
          ],
        },
      })
      expect(res.status(), 'ölçüm gönderme').toBe(202)
    },
  }
}

async function withSession(browser: Browser, baseURL: string | undefined) {
  const api = await request.newContext({ baseURL, storageState })
  const context = await browser.newContext({ baseURL, storageState })
  return { api, context }
}

test.describe('sunucu listesi (gerçek tarayıcı + gerçek arka uç)', () => {
  test.skip(!email || !password, 'E2E_EMAIL ve E2E_PASSWORD tanımlı değil')

  test('kart: ad, hostname, çevrimiçi rozeti ve son değerler', async ({ browser, baseURL }) => {
    const { api, context } = await withSession(browser, baseURL)
    const node = await createNode(api, uniqueName('e2e-kart'))
    await node.postSample({ cpu: 42.5, mem: 61, disk: 70 }, 'demo-sunucu-1')

    const page = await context.newPage()
    await page.goto('/')

    const card = page.getByTestId('node-card').filter({ hasText: node.name })
    await expect(card.getByText('Çevrimiçi')).toBeVisible()
    await expect(card.getByText('demo-sunucu-1')).toBeVisible() // the hostname was sent with the sample
    await expect(card.getByText('42,5 %')).toBeVisible()
    await expect(card.getByText('61,0 %')).toBeVisible()
    await expect(card.getByText('70,0 %')).toBeVisible()
    await expect(page.getByTestId('node-summary')).toContainText('çevrimiçi')
    await page.screenshot({ path: shot('10-sunucu-listesi') })

    await context.close()
    await api.dispose()
  })

  test('çevrimiçi durumu SUNUCUDAN gelir: tarayıcı saati 3 gün ileri alınsa da değişmez', async ({
    browser,
    baseURL,
  }) => {
    const { api, context } = await withSession(browser, baseURL)
    const node = await createNode(api, uniqueName('e2e-saat'))
    await node.postSample({ cpu: 10, mem: 20, disk: 30 })

    const page = await context.newPage()
    // Pin the browser's Date.now() three days ahead. If the status were computed from the browser clock,
    // the server would look "seen 3 days ago" and offline.
    await page.clock.setFixedTime(new Date(Date.now() + 3 * 24 * 3600 * 1000))
    await page.goto('/')

    // Precondition: the browser clock really is 3 days ahead (otherwise the test proves nothing).
    const browserNow = await page.evaluate(() => Date.now())
    expect(browserNow - Date.now()).toBeGreaterThan(2 * 24 * 3600 * 1000)

    const card = page.getByTestId('node-card').filter({ hasText: node.name })
    await expect(card.getByText('Çevrimiçi')).toBeVisible()
    await expect(card).not.toContainText('gün önce')

    await context.close()
    await api.dispose()
  })

  test('ölçüm gelmeyince sunucu çevrimdışına düşer (eski değerler soluk gösterilir)', async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(90_000)
    const { api, context } = await withSession(browser, baseURL)
    const node = await createNode(api, uniqueName('e2e-cikis'))
    await node.postSample({ cpu: 33, mem: 44, disk: 55 })

    const page = await context.newPage()
    await page.goto('/')
    const card = page.getByTestId('node-card').filter({ hasText: node.name })
    await expect(card.getByText('Çevrimiçi')).toBeVisible()

    // 15 s threshold + 10 s list refresh → offline within ~25 s.
    await expect(card.getByText('Çevrimdışı')).toBeVisible({ timeout: 45_000 })
    await expect(card).toHaveAttribute('data-online', 'false')
    await expect(card.getByText('33,0 %')).toBeVisible() // last values are kept
    await page.screenshot({ path: shot('11-cevrimdisi') })

    await context.close()
    await api.dispose()
  })

  test('hiç ölçümü olmayan sunucu: "Henüz ölçüm yok" ve "hiç görülmedi"', async ({ browser, baseURL }) => {
    const { api, context } = await withSession(browser, baseURL)
    const node = await createNode(api, uniqueName('e2e-bos'))

    const page = await context.newPage()
    await page.goto('/')

    const card = page.getByTestId('node-card').filter({ hasText: node.name })
    await expect(card.getByText('Çevrimdışı')).toBeVisible()
    await expect(card.getByText('Henüz ölçüm yok')).toBeVisible()
    await expect(card.getByText('Son görülme: hiç görülmedi')).toBeVisible()

    await context.close()
    await api.dispose()
  })
})
