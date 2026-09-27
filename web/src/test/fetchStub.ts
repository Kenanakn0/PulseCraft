import { vi } from 'vitest'

export interface RecordedRequest {
  method: string
  path: string
  body: unknown
}

type Handler = (request: RecordedRequest) => Response | Promise<Response>

/**
 * Replaces global fetch with a response table keyed by "METHOD /path". Behaves like fetch: an aborted
 * request rejects with AbortError. A request missing from the table is a test bug and fails loudly.
 */
export function stubFetch(routes: Record<string, Handler>) {
  const calls: RecordedRequest[] = []

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
    const method = init?.method ?? 'GET'
    const request: RecordedRequest = {
      method,
      path,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    }
    calls.push(request)

    const handler = routes[`${method} ${path}`]
    if (handler === undefined) throw new Error(`Testte tanımsız istek: ${method} ${path}`)

    const response = await handler(request)
    if (init?.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
    return response
  })

  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, calls }
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

export function textResponse(text: string, status: number, headers: Record<string, string> = {}): Response {
  return new Response(text, { status, headers })
}

export const testUser = { id: 1, email: 'ada@example.test', display_name: 'Ada Test' }
export const meResponse = { user: testUser, expires_at: '2030-01-01T00:00:00Z' }
