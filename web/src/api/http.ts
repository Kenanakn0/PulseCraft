// The single gateway to the server: error shape, cookie handling and the "session ended" (401) behaviour
// are defined in one place.

/** Thrown for non-2xx responses and when no response arrives at all. */
export class ApiError extends Error {
  /** HTTP status. 0 = the server could not be reached (network error). */
  readonly status: number
  /** The server's Retry-After (seconds) on 429. */
  readonly retryAfterSeconds: number | undefined

  constructor(status: number, message: string, retryAfterSeconds?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

// "Session ended" notification: any request that gets 401 (e.g. the token expired) notifies the listeners.
// AuthProvider listens and returns the user to the login page. onUnauthorized returns an unsubscribe
// function that doubles as an effect cleanup.
type Listener = () => void
const unauthorizedListeners = new Set<Listener>()

export function onUnauthorized(listener: Listener): () => void {
  unauthorizedListeners.add(listener)
  return () => {
    unauthorizedListeners.delete(listener)
  }
}

/** Notifies listeners that the session ended (HTTP 401 or WebSocket close code 4401). */
export function notifyUnauthorized(): void {
  for (const listener of unauthorizedListeners) listener()
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  /** Lets the request be cancelled when the component unmounts. */
  signal?: AbortSignal
  /**
   * When true, a 401 does NOT trigger the global "session ended" notice: a wrong password at login is a
   * 401 too, but not an ended session.
   */
  silent401?: boolean
}

/**
 * JSON request. Throws ApiError on failure; a cancelled request rethrows the original AbortError
 * (cancelling is not an error).
 *
 * Note: `T` is a compile-time assertion only. Types are erased at runtime, so nothing checks that the
 * server actually returned this shape.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, silent401 = false } = options

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      // The httpOnly session cookie is sent automatically to the same origin; JavaScript never sees the token.
      credentials: 'same-origin',
      signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(0, 'Sunucuya ulaşılamadı')
  }

  if (!response.ok) {
    const text = (await response.text().catch(() => '')).trim()

    if (response.status === 401 && !silent401) {
      notifyUnauthorized()
    }

    const retryAfter = Number(response.headers.get('Retry-After'))
    throw new ApiError(
      response.status,
      text || response.statusText,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    )
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}
