import { defineConfig, devices } from '@playwright/test'

// Tarayıcı (Chromium) testleri. Çalıştırmadan önce:
//   1) Arka uç ayakta olmalı (docker compose; ya da sahte kimlik bilgili bir prova yığını)
//   2) Ortam değişkenleri: E2E_EMAIL, E2E_PASSWORD (giriş yapabilen bir kullanıcı), iki kullanıcılı
//      testler için E2E_EMAIL2, E2E_PASSWORD2 ve isteğe bağlı VITE_PROXY_TARGET (arka ucun adresi;
//      varsayılan http://127.0.0.1:8080)
// Kimlik bilgisi yoksa ilgili testler atlanır. Giriş, "setup" projesinde (e2e/auth.setup.ts) kullanıcı başına
// TEK kez yapılır; testler çerezi e2e/.auth/ altından okur (giriş oran sınırı: IP başına dakikada 10).
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1, // giriş denemeleri IP başına dakikada 10 ile sınırlı; testler sırayla çalışsın
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },

  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, dependencies: ['setup'] },
  ],

  // Vite geliştirme sunucusunu başlatır (zaten çalışıyorsa onu kullanır).
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
