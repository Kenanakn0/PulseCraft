import { expect, request, test as setup } from '@playwright/test'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { USER1_STATE, USER2_STATE } from './auth-state'

// "Setup projesi" (playwright.config.ts → projects): diğer tüm testlerden ÖNCE, web sunucusu ayaktayken bir kez
// çalışır. Giriş baseURL (Vite, localhost:5173) üzerinden yapılır ki çerez tarayıcının kullanacağı alan adına yazılsın.
// C# karşılığı: xUnit'te tüm test sınıflarının paylaştığı bir ICollectionFixture.
const users = [
  { email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD, file: USER1_STATE },
  { email: process.env.E2E_EMAIL2, password: process.env.E2E_PASSWORD2, file: USER2_STATE },
]

setup('oturumları hazırla (kullanıcı başına tek giriş)', async ({ baseURL }) => {
  rmSync(dirname(USER1_STATE), { recursive: true, force: true }) // eski (belki iptal edilmiş) oturumlar kalmasın
  mkdirSync(dirname(USER1_STATE), { recursive: true })

  for (const { email, password, file } of users) {
    if (!email || !password) continue
    const api = await request.newContext({ baseURL })
    const res = await api.post('/api/v1/auth/login', { data: { email, password } })
    expect(res.ok(), `${email} ile giriş (HTTP ${res.status()})`).toBe(true)
    await api.storageState({ path: file })
    await api.dispose()
  }
})
