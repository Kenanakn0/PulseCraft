import { request, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { USER1_STATE, USER2_STATE } from './auth-state'
import { expect, test } from './fixtures'

// 4.2d: 4.2/4.2a/4.2b/4.2c'nin BÜTÜNÜNÜ, iki AYRI kullanıcı oturumuyla (iki AYRI JWT, iki AYRI
// WebSocket bağlantısı) kanıtlar. Önceki testlerde "iki sekme" hep AYNI oturumun kopyasıydı; burada
// Ada ve Bob'un çerezleri baştan başka giriş isteklerinden gelir — sunucunun olayı DOĞRU KULLANICIYA
// (acknowledged_by) ve BAĞIMSIZ oturumlara dağıttığını, birinin çıkışının diğerini etkilemediğini
// gösterir (4.0c/4.1d'de tek kullanıcı iki sekmesiyle test edilenin, gerçek çok kullanıcılı hâli).
const emailA = process.env.E2E_EMAIL
const passwordA = process.env.E2E_PASSWORD
const emailB = process.env.E2E_EMAIL2
const passwordB = process.env.E2E_PASSWORD2

const shot = (name: string) => `e2e/screenshots/${name}.png`
const uniqueName = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`

async function loginSession(baseURL: string | undefined, email: string, password: string) {
  const api = await request.newContext({ baseURL })
  const response = await api.post('/api/v1/auth/login', { data: { email, password } })
  expect(response.ok(), `${email} ile giriş`).toBe(true)
  const storageState = await api.storageState()
  await api.dispose()
  return storageState
}

interface Session {
  api: APIRequestContext
  page: Page
}

// storageState: setup projesinin yazdığı dosyanın YOLU ya da bu testte yapılan taze girişin durumu.
type StorageState = string | Awaited<ReturnType<typeof loginSession>>

async function openSession(browser: Browser, baseURL: string | undefined, storageState: StorageState): Promise<Session> {
  const api = await request.newContext({ baseURL, storageState })
  const context = await browser.newContext({ baseURL, storageState })
  const page = await context.newPage()
  return { api, page }
}

test.describe('iki KULLANICILI uçtan uca (4.2 bütünü: kurallar ekranı → alarm → çapraz kullanıcı pano)', () => {
  test.skip(
    !emailA || !passwordA || !emailB || !passwordB,
    'E2E_EMAIL/E2E_PASSWORD (Ada) ve E2E_EMAIL2/E2E_PASSWORD2 (Bob) tanımlı değil',
  )

  test('Ada kuralı arayüzden oluşturur; agent ölçümüyle açılan alarmı Bob AYRI OTURUMUNDA anında görür, incelemeye alır; Ada Kurallar ekranından kapatır; ikisinde de anında çözülür', async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(30_000)

    // Paylaşılan oturumlar (setup projesi her kullanıcı için bir kez giriş yaptı).
    const ada = await openSession(browser, baseURL, USER1_STATE)
    const bob = await openSession(browser, baseURL, USER2_STATE)

    // Öncül: gerçekten İKİ FARKLI kullanıcı girişi (aynı oturumun iki sekmesi değil).
    await ada.page.goto('/')
    await bob.page.goto('/')
    const adaName = await ada.page.getByTestId('current-user').textContent()
    const bobName = await bob.page.getByTestId('current-user').textContent()
    expect(adaName).not.toBe(bobName)

    const nodeName = uniqueName('e2e-2k-node')
    const created = await ada.api.post('/api/v1/nodes', { data: { name: nodeName } })
    expect(created.status()).toBe(201)
    const { id: nodeId, api_key: apiKey } = (await created.json()) as { id: string; api_key: string }

    // 4.2c: Ada kuralı ARAYÜZDEN oluşturur (konsol/API değil).
    const ruleName = uniqueName('e2e-2k-kural')
    await ada.page.goto('/alert-rules')
    await ada.page.getByLabel('Ad').fill(ruleName)
    await ada.page.getByLabel('Sunucu').selectOption({ label: nodeName })
    await ada.page.getByLabel('Eşik (%)').fill('1')
    await ada.page.getByRole('button', { name: 'Kural ekle' }).click()
    await expect(ada.page.getByTestId('rule-row').filter({ hasText: ruleName })).toBeVisible()

    // Bob önceden alarm panosunu açmış olsun (canlı akışı bekliyor).
    await bob.page.goto('/alerts')
    await expect(bob.page.getByTestId('live-status')).toHaveText('Canlı')

    // Agent gibi bir ölçüm: eşik aşılır, alarm açılır.
    const post = await ada.api.post('/api/v1/metrics', {
      headers: { Authorization: `Bearer ${apiKey}` },
      data: {
        samples: [
          { time: new Date().toISOString(), cpu_percent: 55, mem_percent: 10, mem_used_bytes: 1, disk_percent: 10, net_rx_bps: 1, net_tx_bps: 1, load1: null },
        ],
      },
    })
    expect(post.status()).toBe(202)

    // 4.2b: Bob'un panosunda (KENDİ oturumu, KENDİ WebSocket'i) alarm anında görünür.
    const bobCard = bob.page.getByTestId('alert-card').filter({ hasText: ruleName })
    await expect(bobCard).toBeVisible({ timeout: 4000 })
    await expect(bobCard.getByRole('link', { name: nodeName })).toHaveAttribute('href', `/nodes/${nodeId}`)

    // Bob incelemeye alır.
    await bobCard.getByRole('button', { name: 'İncelemeye aldım' }).click()
    await expect(bob.page.getByTestId('alert-card').filter({ hasText: ruleName })).toHaveCount(0) // "Açık"tan düştü

    // Ada, KENDİ panosunda, Bob'un adıyla "inceliyor" durumunu ANINDA görür (sayfayı hiç yenilemeden).
    await ada.page.goto('/alerts')
    await ada.page.getByRole('tab', { name: /İncelenen/ }).click()
    const adaViewOfCard = ada.page.getByTestId('alert-card').filter({ hasText: ruleName })
    await expect(adaViewOfCard).toContainText('inceliyor')
    await expect(adaViewOfCard).toContainText(bobName!.trim())
    await ada.page.screenshot({ path: shot('40-iki-kullanici-incelenen') })

    // 4.2c: Ada, Kurallar ekranından kuralı DEVRE DIŞI bırakır → alarm çözülür.
    await ada.page.goto('/alert-rules')
    const adaRuleRow = ada.page.getByTestId('rule-row').filter({ hasText: ruleName })
    await adaRuleRow.getByRole('button', { name: 'Devre dışı bırak' }).click()
    // İsteğin BİTTİĞİNİ bekle: hemen başka sayfaya gitmek, tarayıcının yarım kalan PUT isteğini iptal etmesine
    // (kural kapanmaz, alarm çözülmez) yol açar — bu testteki eski zamanlama kararsızlığının nedeniydi.
    await expect(adaRuleRow.getByText('Kapalı')).toBeVisible()

    // Her iki oturumda da ANINDA "Çözülen"e geçer; Bob'un adı (incelemeyi alan) korunur.
    for (const s of [ada, bob]) {
      await s.page.goto('/alerts')
      await s.page.getByRole('tab', { name: /Çözülen/ }).click()
      const card = s.page.getByTestId('alert-card').filter({ hasText: ruleName })
      await expect(card).toBeVisible({ timeout: 4000 })
      await expect(card).toContainText(`${bobName!.trim()} incelemişti`)
    }
    await bob.page.screenshot({ path: shot('41-iki-kullanici-cozulen') })

    // Temizlik: kuralı sil (Bob silsin — sahiplik kısıtı yok, herhangi bir oturumdan silinebilir).
    await bob.page.goto('/alert-rules')
    const bobRuleRow = bob.page.getByTestId('rule-row').filter({ hasText: ruleName })
    await bobRuleRow.getByRole('button', { name: 'Sil' }).click()
    await bobRuleRow.getByRole('button', { name: 'Evet, sil' }).click()
    await expect(bob.page.getByTestId('rule-row').filter({ hasText: ruleName })).toHaveCount(0)

    await ada.page.context().close()
    await bob.page.context().close()
    await ada.api.dispose()
    await bob.api.dispose()
  })

  test('oturumlar birbirinden BAĞIMSIZ: Bob çıkış yapınca Ada\'nın canlı bağlantısı ETKİLENMEZ', async ({
    browser,
    baseURL,
  }) => {
    // Bob bu testte ÇIKIŞ yapacak: çıkış token'ı (jti) iptal eder. Paylaşılan Bob oturumunu kullanırsak
    // sonraki testler iptal edilmiş çerezle kalırdı → Bob için TAZE giriş; Ada paylaşılan oturumu kullanır.
    const ada = await openSession(browser, baseURL, USER1_STATE)
    const bob = await openSession(browser, baseURL, await loginSession(baseURL, emailB!, passwordB!))

    await ada.page.goto('/')
    await bob.page.goto('/')
    await expect(ada.page.getByTestId('live-status')).toHaveText('Canlı')
    await expect(bob.page.getByTestId('live-status')).toHaveText('Canlı')

    await bob.page.getByRole('button', { name: 'Çıkış' }).click()
    await expect(bob.page).toHaveURL(/\/login/)

    // Bob'un çıkışı, sunucuda YALNIZCA kendi jti'sini iptal eder; Ada'nın bağlantısı ve oturumu sürer.
    await ada.page.waitForTimeout(1000)
    await expect(ada.page).not.toHaveURL(/\/login/)
    await expect(ada.page.getByTestId('live-status')).toHaveText('Canlı')
    await expect(ada.page.getByTestId('current-user')).toBeVisible()

    await ada.page.context().close()
    await bob.page.context().close()
    await ada.api.dispose()
    await bob.api.dispose()
  })
})
