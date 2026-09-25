import { expect, request, test, type APIRequestContext, type Browser } from '@playwright/test'

const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD

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

test.describe('alarm kuralları ekranı (gerçek tarayıcı + gerçek arka uç)', () => {
  test.skip(!email || !password, 'E2E_EMAIL ve E2E_PASSWORD tanımlı değil')

  test('arayüzden kural oluşturma → listede görünür → devre dışı bırak → sil (konsol kullanmadan)', async ({
    browser,
    baseURL,
  }) => {
    const { api, context } = await withSession(browser, baseURL)
    const nodeName = uniqueName('e2e-kural-node')
    const created = await api.post('/api/v1/nodes', { data: { name: nodeName } })
    expect(created.status()).toBe(201)

    const page = await context.newPage()
    await page.goto('/alert-rules')

    const ruleName = uniqueName('e2e-kural')
    await page.getByLabel('Ad').fill(ruleName)
    await page.getByLabel('Sunucu').selectOption({ label: nodeName })
    await page.getByLabel('Metrik').selectOption('cpu_percent')
    await page.getByLabel('Koşul', { exact: true }).selectOption('>')
    await page.getByLabel('Eşik (%)').fill('90')
    await page.getByLabel('Süre (sn)').fill('30')
    await page.getByLabel('Önem').selectOption('critical')
    await page.getByRole('button', { name: 'Kural ekle' }).click()

    // Form temizlendi (aynı adla ikinci kez eklenmedi) ve satır listede.
    await expect(page.getByLabel('Ad')).toHaveValue('')
    const row = page.getByTestId('rule-row').filter({ hasText: ruleName })
    await expect(row).toBeVisible()
    await expect(row).toContainText('CPU > 90 % (30 sn boyunca)')
    await expect(row).toContainText(nodeName)
    await expect(row).toContainText('Kritik')
    await expect(row.getByText('Etkin')).toBeVisible()

    // Devre dışı bırak
    await row.getByRole('button', { name: 'Devre dışı bırak' }).click()
    await expect(row.getByText('Kapalı')).toBeVisible()
    await expect(row.getByRole('button', { name: 'Etkinleştir' })).toBeVisible()

    // Sil: onay olmadan vazgeçilirse satır kalır.
    await row.getByRole('button', { name: 'Sil' }).click()
    await expect(row).toContainText('Geçmiş alarmlar da silinir')
    await row.getByRole('button', { name: 'Vazgeç' }).click()
    await expect(row).toBeVisible()

    await row.getByRole('button', { name: 'Sil' }).click()
    await row.getByRole('button', { name: 'Evet, sil' }).click()
    await expect(page.getByTestId('rule-row').filter({ hasText: ruleName })).toHaveCount(0)
  })

  test('kural oluşturma formu, arayüzden başlatılan kural + agent ölçümüyle GERÇEK bir alarm üretir (4.2b + 4.2c bütünü)', async ({
    browser,
    baseURL,
  }) => {
    const { api, context } = await withSession(browser, baseURL)
    const nodeName = uniqueName('e2e-butun-node')
    const created = await api.post('/api/v1/nodes', { data: { name: nodeName } })
    const { id: nodeId, api_key: apiKey } = (await created.json()) as { id: string; api_key: string }

    const page = await context.newPage()
    await page.goto('/alert-rules')

    const ruleName = uniqueName('e2e-butun-kural')
    await page.getByLabel('Ad').fill(ruleName)
    await page.getByLabel('Sunucu').selectOption({ label: nodeName })
    await page.getByLabel('Eşik (%)').fill('1') // hemen tetiklensin
    await page.getByRole('button', { name: 'Kural ekle' }).click()
    await expect(page.getByTestId('rule-row').filter({ hasText: ruleName })).toBeVisible()

    // Alarm panosuna geç: WebSocket zaten bağlı, agent gibi bir ölçüm gönder.
    await page.goto('/alerts')
    await expect(page.getByTestId('live-status')).toHaveText('Canlı')
    const post = await api.post('/api/v1/metrics', {
      headers: { Authorization: `Bearer ${apiKey}` },
      data: { samples: [{ time: new Date().toISOString(), cpu_percent: 50, mem_percent: 1, mem_used_bytes: 1, disk_percent: 1, net_rx_bps: 1, net_tx_bps: 1, load1: null }] },
    })
    expect(post.status()).toBe(202)

    const alertCard = page.getByTestId('alert-card').filter({ hasText: ruleName })
    await expect(alertCard).toBeVisible({ timeout: 4000 })
    await expect(alertCard.getByRole('link', { name: nodeName })).toHaveAttribute('href', `/nodes/${nodeId}`)

    // Temizlik: kuralı sil (geçmişiyle gider).
    await page.goto('/alert-rules')
    const row = page.getByTestId('rule-row').filter({ hasText: ruleName })
    await row.getByRole('button', { name: 'Sil' }).click()
    await row.getByRole('button', { name: 'Evet, sil' }).click()

    await context.close()
    await api.dispose()
  })

  test('form doğrulaması ve sunucu hatası arayüzde Türkçe gösterilir', async ({ browser, baseURL }) => {
    const { context } = await withSession(browser, baseURL)
    const page = await context.newPage()
    await page.goto('/alert-rules')

    await page.getByRole('button', { name: 'Kural ekle' }).click()
    await expect(page.getByRole('alert')).toHaveText('Kural adı zorunlu.')

    await page.getByLabel('Ad').fill(uniqueName('e2e-hatali-kural'))
    await page.getByLabel('Eşik (%)').fill('abc')
    await page.getByRole('button', { name: 'Kural ekle' }).click()
    await expect(page.getByRole('alert')).toHaveText('Eşik geçerli bir sayı olmalı.')

    await context.close()
  })
})
