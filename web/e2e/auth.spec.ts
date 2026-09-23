import { expect, test } from '@playwright/test'

const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD

// Görsel kontrol için ekran görüntüleri (git'e girmez; README görselleri 4.3'te bilinçli alınır).
const shot = (name: string) => `e2e/screenshots/${name}.png`

test.describe('kimlik doğrulama akışı (gerçek tarayıcı + gerçek arka uç)', () => {
  test.skip(!email || !password, 'E2E_EMAIL ve E2E_PASSWORD tanımlı değil')

  test('girişsiz ziyaret /login\'e yönlendirir', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'PulseCraft' })).toBeVisible()
    await page.screenshot({ path: shot('01-login') })
  })

  test('yanlış parola hata gösterir ve formda kalır', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('E-posta').fill(email!)
    await page.getByLabel('Parola').fill('kesinlikle-yanlis-parola')
    await page.getByRole('button', { name: 'Giriş yap' }).click()

    await expect(page.getByRole('alert')).toHaveText('E-posta veya parola hatalı.')
    await expect(page).toHaveURL(/\/login$/)
    await page.screenshot({ path: shot('02-login-hata') })
  })

  test('doğru giriş → panel; yenilemede oturum sürer; JS token\'ı göremez; çıkış → login', async ({
    page,
    context,
  }) => {
    await page.goto('/login')
    await page.getByLabel('E-posta').fill(email!)
    await page.getByLabel('Parola').fill(password!)
    await page.getByRole('button', { name: 'Giriş yap' }).click()

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: 'Sunucular' })).toBeVisible()
    await expect(page.getByTestId('current-user')).not.toBeEmpty()
    await page.screenshot({ path: shot('03-panel') })

    // Cookie: httpOnly + SameSite=Strict; sayfadaki JavaScript onu okuyamaz.
    const cookie = (await context.cookies()).find((c) => c.name === 'pulsecraft_session')
    expect(cookie, 'oturum cookie\'si').toBeDefined()
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('Strict')
    expect(await page.evaluate(() => document.cookie)).not.toContain('pulsecraft_session')

    // Sayfa yenilenince oturum cookie'den geri gelir (GET /auth/me).
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Sunucular' })).toBeVisible()

    // Çıkış.
    await page.getByRole('button', { name: 'Çıkış' }).click()
    await expect(page).toHaveURL(/\/login$/)

    // Çıkıştan sonra korumalı sayfaya doğrudan gitmek yine /login'e döner.
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
  })

  test('girişliyken /login paneli açar; girişten sonra istenen sayfaya dönülür', async ({ page }) => {
    // Girişsiz iken bilinmeyen bir derin bağlantı → /login → giriş → panel ("*" kuralı).
    await page.goto('/bir/derin/baglanti')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByLabel('E-posta').fill(email!)
    await page.getByLabel('Parola').fill(password!)
    await page.getByRole('button', { name: 'Giriş yap' }).click()
    await expect(page.getByRole('heading', { name: 'Sunucular' })).toBeVisible()

    await page.goto('/login')
    await expect(page).toHaveURL(/\/$/)

    await page.getByRole('button', { name: 'Çıkış' }).click()
  })
})

test.describe('koyu tema', () => {
  test.skip(!email || !password, 'E2E_EMAIL ve E2E_PASSWORD tanımlı değil')
  test.use({ colorScheme: 'dark' })

  test('giriş sayfası koyu temada okunaklı', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('button', { name: 'Giriş yap' })).toBeVisible()
    await page.screenshot({ path: shot('04-login-koyu') })
  })
})
