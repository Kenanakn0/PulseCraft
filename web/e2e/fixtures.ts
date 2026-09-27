import { request, test as base } from '@playwright/test'
import { hasUser1, USER1_STATE } from './auth-state'

interface NodeRow {
  id: string
  name: string
}
interface RuleRow {
  id: number
  name: string
  node_id: string | null
}

// Test verisi temizliği (otomatik fixture): her testten ÖNCE var olan sunucular not edilir; test BİTİNCE — başarısız
// olsa bile — o test sırasında oluşturulan `e2e-*` sunucular ve genel (sunucuya bağlı olmayan) `e2e-*` kurallar
// silinir. Sunucuya bağlı kurallar, metrikler ve alarmlar sunucuyla birlikte cascade ile gider.
// Neden: yarıda kalan testler kendi temizliğine ulaşamayıp prova veritabanında kalıntı bırakıyordu; bu kalıntılar
// sonraki koşularda beklenmeyen sayılar ("Açık 2", "İncelenen 5") üretip teşhisi karıştırdı (bkz. docs/decisions.md 4.2d).
// C# karşılığı: her testten sonra çalışan bir IAsyncLifetime.DisposeAsync.
export const test = base.extend<{ cleanupE2EData: void }>({
  cleanupE2EData: [
    async ({ baseURL }, runTest) => {
      if (!hasUser1) return runTest()
      const api = await request.newContext({ baseURL, storageState: USER1_STATE })
      const list = async <T>(path: string): Promise<T[]> => {
        const res = await api.get(path)
        return res.ok() ? ((await res.json()) as T[]) : []
      }
      const before = new Set((await list<NodeRow>('/api/v1/nodes')).map((n) => n.id))
      try {
        await runTest()
      } finally {
        for (const rule of await list<RuleRow>('/api/v1/alert-rules')) {
          if (rule.node_id === null && rule.name.startsWith('e2e-')) await api.delete(`/api/v1/alert-rules/${rule.id}`)
        }
        for (const node of await list<NodeRow>('/api/v1/nodes')) {
          if (!before.has(node.id) && node.name.startsWith('e2e-')) await api.delete(`/api/v1/nodes/${node.id}`)
        }
        await api.dispose()
      }
    },
    { auto: true },
  ],
})

export { expect } from '@playwright/test'
