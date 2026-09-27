import { defineConfig, devices } from '@playwright/test'

// README EKRAN GÖRÜNTÜLERİ (test değil, belge üretici). Derlenmiş uygulamaya (nginx) karşı, UYDURMA verilerle
// çalışır ve görüntüleri ../docs/screenshots/ altına yazar (bilinçli olarak commit'lenir).
//
//   Ortam değişkenleri: SHOTS_BASE_URL (varsayılan http://127.0.0.1:18080), SHOTS_ADMIN_EMAIL/SHOTS_ADMIN_PASSWORD
//   (görünen adı "Admin" olan PROVA kullanıcısı), SHOTS_OPS_EMAIL/SHOTS_OPS_PASSWORD (görünen adı "Operatör").
//   Parolaları komut satırına yazmayın; yalnızca sahte kimlik bilgili prova yığınının değerlerini kullanın.
//   npm run docs:shots
//
// DİKKAT: sunucu, kural ve alarm OLUŞTURUR. Yalnızca boş, sahte kimlik bilgili bir PROVA yığınına karşı çalıştırın;
// gerçek verinizle çalıştırmak hem verinizi kirletir hem de gerçek adlar/değerler görüntülere girer.
export default defineConfig({
  testDir: './docs-shots',
  testMatch: /.*\.shots\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: process.env.SHOTS_BASE_URL ?? 'http://127.0.0.1:18080',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
})
