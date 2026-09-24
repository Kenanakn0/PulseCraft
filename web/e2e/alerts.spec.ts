import { expect, request, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'

const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD

const shot = (name: string) => `e2e/screenshots/${name}.png`

let storageState: Awaited<ReturnType<APIRequestContext['storageState']>>

test.beforeAll(async ({ playwright, baseURL }) => {
  if (!email || !password) return
  const api = await playwright.request.newContext({ baseURL })
  const response = await api.post('/api/v1/auth/login', { data: { email, password } })
  expect(response.ok(), 'API ile giriş').toBe(true)
  storageState = await api.storageState()
  await api.dispose()
})

const uniqueName = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`

async function withSession(browser: Browser, baseURL: string | undefined) {
  const api = await request.newContext({ baseURL, storageState })
  const context = await browser.newContext({ baseURL, storageState })
  return { api, context }
}

/** Yalnızca BU testin node'una bağlı, düşük eşikli bir kural ve o node'a ölçüm gönderen yardımcılar. */
async function setup(api: APIRequestContext, prefix: string) {
  const nodeName = uniqueName(`${prefix}-node`)
  const ruleName = uniqueName(`${prefix}-kural`)

  const created = await api.post('/api/v1/nodes', { data: { name: nodeName } })
  expect(created.status(), 'node oluşturma').toBe(201)
  const { id: nodeId, api_key: apiKey } = (await created.json()) as { id: string; api_key: string }

  const ruleBody = {
    name: ruleName,
    node_id: nodeId,
    metric: 'cpu_percent',
    operator: '>',
    threshold: 1,
    duration_seconds: 0,
    severity: 'critical',
    enabled: true,
  }
  const rule = await api.post('/api/v1/alert-rules', { data: ruleBody })
  expect(rule.status(), 'kural oluşturma').toBe(201)
  const { id: ruleId } = (await rule.json()) as { id: number }

  const post = async (cpu: number) => {
    const res = await api.post('/api/v1/metrics', {
      headers: { Authorization: `Bearer ${apiKey}` },
      data: {
        samples: [
          {
            time: new Date().toISOString(),
            cpu_percent: cpu,
            mem_percent: 40,
            mem_used_bytes: 1,
            disk_percent: 50,
            net_rx_bps: 1,
            net_tx_bps: 1,
            load1: null,
          },
        ],
      },
    })
    expect(res.status(), 'ölçüm gönderme').toBe(202)
  }

  const putRule = (patch: Record<string, unknown>) =>
    api.put(`/api/v1/alert-rules/${ruleId}`, { data: { ...ruleBody, ...patch } })

  const remove = () => api.delete(`/api/v1/alert-rules/${ruleId}`)

  return { nodeName, ruleName, nodeId, ruleId, post, putRule, remove }
}

const card = (page: Page, ruleName: string) => page.getByTestId('alert-card').filter({ hasText: ruleName })
const tab = (page: Page, name: RegExp) => page.getByRole('tab', { name })

test.describe('ortak alarm panosu (gerçek tarayıcı + gerçek WebSocket)', () => {
  test.skip(!email || !password, 'E2E_EMAIL ve E2E_PASSWORD tanımlı değil')

  test('yeni alarm sayfa yenilenmeden listeye ve üst çubuk sayacına girer; sunucu bağlantısı verilir', async ({
    browser,
    baseURL,
  }) => {
    const { api, context } = await withSession(browser, baseURL)
    const s = await setup(api, 'e2e-canli-alarm')

    const page = await context.newPage()
    await page.goto('/alerts')
    await expect(page.getByTestId('live-status')).toHaveText('Canlı')
    await expect(card(page, s.ruleName)).toHaveCount(0)

    await s.post(50)

    const c = card(page, s.ruleName)
    await expect(c).toBeVisible({ timeout: 4000 })
    await expect(c).toContainText('Kritik')
    await expect(c).toContainText('CPU 50,0 % (eşik > 1 %)')
    await expect(c.getByRole('link', { name: s.nodeName })).toHaveAttribute('href', `/nodes/${s.nodeId}`)
    await expect(page.getByTestId('open-alerts-badge')).toBeVisible()
    await page.screenshot({ path: shot('30-alarm-panosu-acik'), fullPage: true })

    await s.remove()
    await context.close()
    await api.dispose()
  })

  test('iki sekme: birinde "İncelemeye aldım" diğerinde ANINDA görünür (kim aldığıyla); sonra çözülür', async ({
    browser,
    baseURL,
  }) => {
    const { api, context } = await withSession(browser, baseURL)
    const s = await setup(api, 'e2e-iki-sekme')

    const a = await context.newPage()
    const b = await context.newPage()
    await a.goto('/alerts')
    await b.goto('/alerts')
    await expect(a.getByTestId('live-status')).toHaveText('Canlı')
    await expect(b.getByTestId('live-status')).toHaveText('Canlı')

    await s.post(50)
    await expect(card(a, s.ruleName)).toBeVisible({ timeout: 4000 })
    await expect(card(b, s.ruleName)).toBeVisible({ timeout: 4000 })

    await card(a, s.ruleName).getByRole('button', { name: 'İncelemeye aldım' }).click()

    // B'de sayfa YENİLENMEDEN: kart "Açık"tan düştü, "İncelenen"de ve kimin aldığı görünüyor.
    await expect(card(b, s.ruleName)).toHaveCount(0, { timeout: 3000 })
    await tab(b, /İncelenen/).click()
    await expect(card(b, s.ruleName)).toContainText('E2E Kullanici')
    await expect(card(b, s.ruleName)).toContainText('inceliyor')
    await expect(card(b, s.ruleName).getByRole('button')).toHaveCount(0)
    await b.screenshot({ path: shot('31-alarm-panosu-incelenen'), fullPage: true })

    // Eşik altına inince alarm çözülür (iki sekmede de "Çözülen"e geçer, süre görünür).
    await s.post(0.5)
    await tab(b, /Çözülen/).click()
    await expect(card(b, s.ruleName)).toContainText('Süre:', { timeout: 4000 })
    await expect(card(b, s.ruleName)).toContainText('E2E Kullanici incelemişti')
    await b.screenshot({ path: shot('32-alarm-panosu-cozulen'), fullPage: true })

    await s.remove()
    await context.close()
    await api.dispose()
  })

  test('kural devre dışı bırakılınca açık alarm canlı olarak çözülür (S2); yeniden etkinleşince yeni alarm açılır', async ({
    browser,
    baseURL,
  }) => {
    const { api, context } = await withSession(browser, baseURL)
    const s = await setup(api, 'e2e-devre-disi')

    const page = await context.newPage()
    await page.goto('/alerts')
    await s.post(50)
    await expect(card(page, s.ruleName)).toBeVisible({ timeout: 4000 })

    expect((await s.putRule({ enabled: false })).status()).toBe(200)

    await expect(card(page, s.ruleName)).toHaveCount(0, { timeout: 4000 }) // "Açık"tan çıktı
    await tab(page, /Çözülen/).click()
    await expect(card(page, s.ruleName)).toBeVisible()

    expect((await s.putRule({ enabled: true })).status()).toBe(200)
    await s.post(60)
    await tab(page, /Açık/).click()
    await expect(card(page, s.ruleName)).toBeVisible({ timeout: 4000 })

    await s.remove()
    await context.close()
    await api.dispose()
  })

  test('kural silinince alarmları (geçmiş dahil) açık sekmelerden canlı olarak kalkar', async ({ browser, baseURL }) => {
    const { api, context } = await withSession(browser, baseURL)
    const s = await setup(api, 'e2e-kural-sil')

    const page = await context.newPage()
    await page.goto('/alerts')
    await s.post(50)
    await expect(card(page, s.ruleName)).toBeVisible({ timeout: 4000 })

    expect((await s.remove()).status()).toBe(204)

    await expect(card(page, s.ruleName)).toHaveCount(0, { timeout: 4000 })
    await tab(page, /Çözülen/).click()
    await expect(card(page, s.ruleName)).toHaveCount(0) // "resolved" olarak da kalmadı: cascade + rule olayı

    await context.close()
    await api.dispose()
  })

  test('ack yarışı: iki sekme aynı anda basarsa alarm TEK kez incelemeye alınır, iki sekme de aynı sonucu gösterir', async ({
    browser,
    baseURL,
  }) => {
    const { api, context } = await withSession(browser, baseURL)
    const s = await setup(api, 'e2e-yaris')

    const a = await context.newPage()
    const b = await context.newPage()
    await a.goto('/alerts')
    await b.goto('/alerts')
    await s.post(50)
    await expect(card(a, s.ruleName)).toBeVisible({ timeout: 4000 })
    await expect(card(b, s.ruleName)).toBeVisible({ timeout: 4000 })

    // İki tıklamayı aynı anda gönder.
    await Promise.all([
      card(a, s.ruleName).getByRole('button', { name: 'İncelemeye aldım' }).click(),
      card(b, s.ruleName).getByRole('button', { name: 'İncelemeye aldım' }).click(),
    ])

    // Sonuçta HER İKİ sekmede de kart "İncelenen"de ve aynı kullanıcıyla görünür; hata yok, çift kayıt yok.
    for (const page of [a, b]) {
      await expect(card(page, s.ruleName)).toHaveCount(0, { timeout: 4000 })
      await tab(page, /İncelenen/).click()
      await expect(card(page, s.ruleName)).toHaveCount(1)
      await expect(card(page, s.ruleName)).toContainText('E2E Kullanici')
    }

    await s.remove()
    await context.close()
    await api.dispose()
  })
})
