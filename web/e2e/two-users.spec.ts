import { request, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { USER1_STATE, USER2_STATE } from './auth-state'
import { expect, test } from './fixtures'

// Proves the whole alert workflow with two SEPARATE user sessions (two JWTs, two WebSocket connections).
// Earlier "two tab" tests shared one session; here Ada's and Bob's cookies come from separate logins, which
// shows that the server attributes the acknowledgement to the right user, delivers events to independent
// sessions, and that one user's logout does not affect the other.
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

// storageState: the path written by the setup project, or the state of a fresh login in this test.
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

    // Shared sessions (the setup project logged each user in once).
    const ada = await openSession(browser, baseURL, USER1_STATE)
    const bob = await openSession(browser, baseURL, USER2_STATE)

    // Precondition: really two different users (not two tabs of one session).
    await ada.page.goto('/')
    await bob.page.goto('/')
    const adaName = await ada.page.getByTestId('current-user').textContent()
    const bobName = await bob.page.getByTestId('current-user').textContent()
    expect(adaName).not.toBe(bobName)

    const nodeName = uniqueName('e2e-2k-node')
    const created = await ada.api.post('/api/v1/nodes', { data: { name: nodeName } })
    expect(created.status()).toBe(201)
    const { id: nodeId, api_key: apiKey } = (await created.json()) as { id: string; api_key: string }

    // Ada creates the rule through the UI (not the API).
    const ruleName = uniqueName('e2e-2k-kural')
    await ada.page.goto('/alert-rules')
    await ada.page.getByLabel('Ad').fill(ruleName)
    await ada.page.getByLabel('Sunucu').selectOption({ label: nodeName })
    await ada.page.getByLabel('Eşik (%)').fill('1')
    await ada.page.getByRole('button', { name: 'Kural ekle' }).click()
    await expect(ada.page.getByTestId('rule-row').filter({ hasText: ruleName })).toBeVisible()

    // Bob already has the alert board open, waiting for the live stream.
    await bob.page.goto('/alerts')
    await expect(bob.page.getByTestId('live-status')).toHaveText('Canlı')

    // A sample like the agent's: the threshold is exceeded and the alert opens.
    const post = await ada.api.post('/api/v1/metrics', {
      headers: { Authorization: `Bearer ${apiKey}` },
      data: {
        samples: [
          { time: new Date().toISOString(), cpu_percent: 55, mem_percent: 10, mem_used_bytes: 1, disk_percent: 10, net_rx_bps: 1, net_tx_bps: 1, load1: null },
        ],
      },
    })
    expect(post.status()).toBe(202)

    // Bob's board (his own session and WebSocket) shows the alert immediately.
    const bobCard = bob.page.getByTestId('alert-card').filter({ hasText: ruleName })
    await expect(bobCard).toBeVisible({ timeout: 4000 })
    await expect(bobCard.getByRole('link', { name: nodeName })).toHaveAttribute('href', `/nodes/${nodeId}`)

    await bobCard.getByRole('button', { name: 'İncelemeye aldım' }).click()
    await expect(bob.page.getByTestId('alert-card').filter({ hasText: ruleName })).toHaveCount(0)

    // Ada sees on her own board, without reloading, that Bob is on it.
    await ada.page.goto('/alerts')
    await ada.page.getByRole('tab', { name: /İncelenen/ }).click()
    const adaViewOfCard = ada.page.getByTestId('alert-card').filter({ hasText: ruleName })
    await expect(adaViewOfCard).toContainText('inceliyor')
    await expect(adaViewOfCard).toContainText(bobName!.trim())
    await ada.page.screenshot({ path: shot('40-iki-kullanici-incelenen') })

    // Ada disables the rule on the rules page → the alert resolves.
    await ada.page.goto('/alert-rules')
    const adaRuleRow = ada.page.getByTestId('rule-row').filter({ hasText: ruleName })
    await adaRuleRow.getByRole('button', { name: 'Devre dışı bırak' }).click()
    // Wait for the request to FINISH: navigating away immediately makes the browser cancel the pending PUT
    // (the rule stays enabled, the alert stays open). This caused this test's earlier flakiness.
    await expect(adaRuleRow.getByText('Kapalı')).toBeVisible()

    // Both sessions move it to "Çözülen" at once; Bob stays recorded as the acknowledging user.
    for (const s of [ada, bob]) {
      await s.page.goto('/alerts')
      await s.page.getByRole('tab', { name: /Çözülen/ }).click()
      const card = s.page.getByTestId('alert-card').filter({ hasText: ruleName })
      await expect(card).toBeVisible({ timeout: 4000 })
      await expect(card).toContainText(`${bobName!.trim()} incelemişti`)
    }
    await bob.page.screenshot({ path: shot('41-iki-kullanici-cozulen') })

    // Cleanup: delete the rule (Bob does it: there is no ownership, any session may delete).
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
    // Bob LOGS OUT in this test, which revokes his token (jti). Using the shared Bob session would leave
    // later tests with a revoked cookie, so Bob logs in fresh; Ada uses the shared session.
    const ada = await openSession(browser, baseURL, USER1_STATE)
    const bob = await openSession(browser, baseURL, await loginSession(baseURL, emailB!, passwordB!))

    await ada.page.goto('/')
    await bob.page.goto('/')
    await expect(ada.page.getByTestId('live-status')).toHaveText('Canlı')
    await expect(bob.page.getByTestId('live-status')).toHaveText('Canlı')

    await bob.page.getByRole('button', { name: 'Çıkış' }).click()
    await expect(bob.page).toHaveURL(/\/login/)

    // Bob's logout revokes only his own jti; Ada's connection and session continue.
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
