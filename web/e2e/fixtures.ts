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

// Automatic cleanup fixture: servers that exist before a test are noted; when the test ends, even if it
// failed, the `e2e-*` servers and global `e2e-*` rules it created are deleted (scoped rules, metrics and
// alerts go with their server by cascade). Aborted tests used to leave data behind that produced confusing
// counts in later runs (see docs/decisions.md "Testing").
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
