import { defineConfig, devices } from '@playwright/test'

// DUMAN TESTİ: Vite geliştirme sunucusuna DEĞİL, docker compose'un sunduğu GERÇEK yığına (nginx + derlenmiş
// React + server) karşı çalışır. e2e/ testlerinden farkı: burada derlenmiş dosyalar, nginx başlıkları
// (CSP, önbellek, gzip), SPA yönlendirmesi ve nginx üzerinden WebSocket doğrulanır.
//
//   $env:SMOKE_BASE_URL="http://localhost:8080"; $env:E2E_EMAIL="..."; $env:E2E_PASSWORD="..."
//   npm run smoke
//
// DİKKAT: bir test node oluşturur ve ölçüm gönderir. Gerçek verinizi kirletmemek için sahte kimlik
// bilgili bir PROVA yığınına karşı çalıştırın.
export default defineConfig({
  testDir: './smoke',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: process.env.SMOKE_BASE_URL ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
