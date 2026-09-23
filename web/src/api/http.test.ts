import { describe, expect, it, vi } from 'vitest'
import { jsonResponse, stubFetch, textResponse } from '../test/fetchStub'
import { ApiError, apiFetch, isAbortError, onUnauthorized } from './http'

describe('apiFetch', () => {
  it('GET: JSON gövdeyi döndürür; cookie için same-origin ve Accept başlığı gönderir', async () => {
    const { fetchMock } = stubFetch({ 'GET /api/x': () => jsonResponse({ a: 1 }) })

    await expect(apiFetch<{ a: number }>('/api/x')).resolves.toEqual({ a: 1 })

    const init = fetchMock.mock.calls[0]?.[1]
    expect(init?.credentials).toBe('same-origin')
    expect(init?.headers).toMatchObject({ Accept: 'application/json' })
    expect(init?.headers).not.toHaveProperty('Content-Type') // gövde yok
  })

  it('POST: gövdeyi JSON olarak gönderir ve Content-Type ekler', async () => {
    const { calls, fetchMock } = stubFetch({ 'POST /api/x': () => jsonResponse({ ok: true }) })

    await apiFetch('/api/x', { method: 'POST', body: { email: 'a@b.c' } })

    expect(calls[0]?.body).toEqual({ email: 'a@b.c' })
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ 'Content-Type': 'application/json' })
  })

  it('204 yanıtında undefined döndürür', async () => {
    stubFetch({ 'POST /api/x': () => new Response(null, { status: 204 }) })
    await expect(apiFetch<void>('/api/x', { method: 'POST' })).resolves.toBeUndefined()
  })

  it('2xx dışında ApiError fırlatır; mesaj olarak sunucunun metnini taşır', async () => {
    stubFetch({ 'GET /api/x': () => textResponse('geçersiz id\n', 400) })

    const err = await apiFetch('/api/x').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 400, message: 'geçersiz id' })
  })

  it('429: Retry-After başlığını saniye olarak okur; geçersiz değeri yok sayar', async () => {
    stubFetch({
      'GET /api/a': () => textResponse('çok fazla', 429, { 'Retry-After': '42' }),
      'GET /api/b': () => textResponse('çok fazla', 429, { 'Retry-After': 'yarın' }),
      'GET /api/c': () => textResponse('çok fazla', 429),
    })

    expect(await apiFetch('/api/a').catch((e: unknown) => e)).toMatchObject({ status: 429, retryAfterSeconds: 42 })
    expect(await apiFetch('/api/b').catch((e: unknown) => e)).toMatchObject({ retryAfterSeconds: undefined })
    expect(await apiFetch('/api/c').catch((e: unknown) => e)).toMatchObject({ retryAfterSeconds: undefined })
  })

  it('ağ hatasında status=0 olan ApiError fırlatır', async () => {
    stubFetch({
      'GET /api/x': () => {
        throw new TypeError('Failed to fetch')
      },
    })
    // stubFetch handler'ı fetch içinde çağırır; fırlatılan hata fetch'in reddi olarak görünür.
    expect(await apiFetch('/api/x').catch((e: unknown) => e)).toMatchObject({ name: 'ApiError', status: 0 })
  })

  it('iptal (AbortError) ApiError\'a çevrilmez, olduğu gibi yeniden fırlatılır', async () => {
    stubFetch({ 'GET /api/x': () => jsonResponse({}) })
    const controller = new AbortController()
    controller.abort()

    const err = await apiFetch('/api/x', { signal: controller.signal }).catch((e: unknown) => e)

    expect(isAbortError(err)).toBe(true)
    expect(err).not.toBeInstanceOf(ApiError)
  })
})

describe('onUnauthorized', () => {
  it('401 alınca dinleyicilere haber verir', async () => {
    stubFetch({ 'GET /api/x': () => textResponse('oturum gerekli', 401) })
    const listener = vi.fn()
    const unsubscribe = onUnauthorized(listener)

    await apiFetch('/api/x').catch(() => undefined)
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
  })

  it('silent401 ise haber vermez (ör. yanlış parola)', async () => {
    stubFetch({ 'POST /api/login': () => textResponse('hatalı', 401) })
    const listener = vi.fn()
    const unsubscribe = onUnauthorized(listener)

    const err = await apiFetch('/api/login', { method: 'POST', silent401: true }).catch((e: unknown) => e)

    expect(err).toMatchObject({ status: 401 })
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('abonelikten çıkınca haber vermez; 401 dışı hatalarda da vermez', async () => {
    stubFetch({
      'GET /api/401': () => textResponse('x', 401),
      'GET /api/500': () => textResponse('x', 500),
    })
    const listener = vi.fn()
    onUnauthorized(listener)()

    await apiFetch('/api/401').catch(() => undefined)
    await apiFetch('/api/500').catch(() => undefined)

    expect(listener).not.toHaveBeenCalled()
  })
})
