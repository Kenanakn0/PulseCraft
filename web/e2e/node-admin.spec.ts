import { request, type Page } from '@playwright/test'
import { USER1_STATE } from './auth-state'
import { expect, test } from './fixtures'

const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD

// Oturum: setup projesinin bir kez yazdığı çerez (kendi girişimizi yapmayız; bkz. e2e/auth-state.ts).
const storageState = USER1_STATE

const uniqueName = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`

/** Agent gibi (yalnızca Bearer anahtarla, çerez OLMADAN) tek ölçüm gönderir; HTTP kodunu döndürür. */
async function ingest(baseURL: string | undefined, apiKey: string, cpu: number) {
  const agent = await request.newContext({ baseURL })
  const res = await agent.post('/api/v1/metrics', {
    headers: { Authorization: `Bearer ${apiKey}` },
    data: {
      samples: [
        { time: new Date().toISOString(), cpu_percent: cpu, mem_percent: 10, mem_used_bytes: 1, disk_percent: 10, net_rx_bps: 1, net_tx_bps: 1, load1: null },
      ],
    },
  })
  const status = res.status()
  await agent.dispose()
  return status
}

/** Arayüzden sunucu ekler ve bir kez gösterilen anahtarı okur. */
async function addNodeViaUI(page: Page, name: string, close = true): Promise<string> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Sunucu ekle' }).click()
  await page.getByLabel('Sunucu adı').fill(name)
  await page.getByRole('button', { name: 'Ekle' }).click()
  const keyInput = page.getByRole('textbox', { name: 'API anahtarı' })
  await expect(keyInput).toHaveValue(/^[0-9a-f]{64}$/)
  const key = await keyInput.inputValue()
  await page.screenshot({ path: 'e2e/screenshots/50-sunucu-ekle-anahtar.png', fullPage: true })
  if (close) await closeKeyPanel(page)
  return key
}

async function closeKeyPanel(page: Page) {
  await page.getByRole('button', { name: 'Tamam, anahtarı kaydettim' }).click()
  await expect(page.getByRole('textbox', { name: 'API anahtarı' })).toHaveCount(0) // anahtar ekrandan gitti
}

test.describe('sunucu ekle / sil (gerçek tarayıcı + gerçek arka uç)', () => {
  test.skip(!email || !password, 'E2E_EMAIL ve E2E_PASSWORD tanımlı değil')

  test('arayüzden eklenen sunucunun anahtarıyla agent ölçüm gönderir; kart çevrimiçi olur', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, storageState })
    const page = await context.newPage()
    const name = uniqueName('e2e-ui-node')

    const key = await addNodeViaUI(page, name, false) // panel açık kalsın: bağlantı göstergesi izlenecek
    const card = page.getByTestId('node-card').filter({ hasText: name })
    await expect(card).toBeVisible()
    await expect(card.getByText('Henüz ölçüm yok')).toBeVisible()
    await expect(page.getByTestId('agent-status')).toHaveText(/Agent bekleniyor/)
    await expect(page.getByText(/go -C agent run \.\/cmd\/agent/)).not.toContainText(key) // komutta anahtar YOK

    expect(await ingest(baseURL, key, 33)).toBe(202)
    await expect(page.getByTestId('agent-status')).toHaveText(/Agent bağlandı/, { timeout: 4000 }) // canlı akıştan
    await closeKeyPanel(page)
    await expect(card.getByText('Çevrimiçi')).toBeVisible({ timeout: 12_000 })
    await expect(card.getByText('33,0 %')).toBeVisible()

    // Temizlik: arayüzden sil.
    await card.getByRole('link', { name }).click()
    await page.getByRole('button', { name: 'Sunucuyu sil…' }).click()
    await page.getByLabel('Sunucu adı').fill(name)
    await page.getByRole('button', { name: 'Kalıcı olarak sil' }).click()
    await expect(page).toHaveURL(/\/$/)
    await context.close()
  })

  test('sunucu silinince: listeye dönülür, başka sekmelerde kart ve alarmları CANLI kalkar, eski anahtar 401 alır', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ baseURL, storageState })
    const admin = await context.newPage()
    const name = uniqueName('e2e-silinecek')
    const key = await addNodeViaUI(admin, name)

    // Bu sunucuya özel düşük eşikli kural (arayüzden) + bir ölçüm → açık alarm.
    const ruleName = uniqueName('e2e-silinecek-kural')
    await admin.goto('/alert-rules')
    await admin.getByLabel('Ad').fill(ruleName)
    await admin.getByLabel('Sunucu').selectOption({ label: name })
    await admin.getByLabel('Eşik (%)').fill('1')
    await admin.getByRole('button', { name: 'Kural ekle' }).click()
    await expect(admin.getByTestId('rule-row').filter({ hasText: ruleName })).toBeVisible()

    // İzleyici sekmeler: liste (REST DONDURULMUŞ: kartın kalkması ancak WebSocket olayından gelebilir) ve alarm panosu.
    const list = await context.newPage()
    let frozen: string | undefined
    await list.route('**/api/v1/nodes', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      frozen ??= await (await route.fetch()).text()
      await route.fulfill({ status: 200, contentType: 'application/json', body: frozen })
    })
    const alerts = await context.newPage()
    await list.goto('/')
    await alerts.goto('/alerts')
    await expect(list.getByTestId('live-status')).toHaveText('Canlı')
    await expect(alerts.getByTestId('live-status')).toHaveText('Canlı')
    await expect(list.getByTestId('node-card').filter({ hasText: name })).toBeVisible()

    expect(await ingest(baseURL, key, 50)).toBe(202)
    await expect(alerts.getByTestId('alert-card').filter({ hasText: ruleName })).toBeVisible({ timeout: 4000 })

    // Sil (detay sayfasından, adı yazarak).
    await admin.goto('/')
    await admin.getByTestId('node-card').filter({ hasText: name }).getByRole('link', { name }).click()
    await admin.getByRole('button', { name: 'Sunucuyu sil…' }).click()
    await expect(admin.getByRole('button', { name: 'Kalıcı olarak sil' })).toBeDisabled()
    await admin.getByLabel('Sunucu adı').fill(name)
    await admin.getByRole('button', { name: 'Kalıcı olarak sil' }).click()
    await expect(admin).toHaveURL(/\/$/)
    await expect(admin.getByTestId('node-card').filter({ hasText: name })).toHaveCount(0)

    // Diğer sekmeler yenilenmeden güncellendi.
    await expect(list.getByTestId('node-card').filter({ hasText: name })).toHaveCount(0, { timeout: 4000 })
    await expect(alerts.getByTestId('alert-card').filter({ hasText: ruleName })).toHaveCount(0, { timeout: 4000 })
    await alerts.getByRole('tab', { name: /Çözülen/ }).click()
    await expect(alerts.getByTestId('alert-card').filter({ hasText: ruleName })).toHaveCount(0) // geçmiş de gitti

    // Sunucuya özel kural da gitti; eski anahtar artık geçersiz.
    await admin.goto('/alert-rules')
    await expect(admin.getByTestId('rule-row').filter({ hasText: ruleName })).toHaveCount(0)
    expect(await ingest(baseURL, key, 50)).toBe(401)

    await context.close()
  })
})
