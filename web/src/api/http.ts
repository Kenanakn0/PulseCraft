// Sunucuyla konuşan tek kapı. Tüm istekler buradan geçer; böylece hata biçimi,
// çerez gönderimi ve "oturum bitti" (401) davranışı tek yerde tanımlıdır.
// (C#'ta HttpClient'ı sarmalayan bir DelegatingHandler / typed client gibi düşünülebilir.)

/** Sunucu 2xx dışında yanıt verdiğinde ya da hiç yanıt gelmediğinde fırlatılır. */
export class ApiError extends Error {
  /** HTTP durum kodu. 0 = sunucuya hiç ulaşılamadı (ağ hatası). */
  readonly status: number
  /** 429'da sunucunun Retry-After başlığı (saniye). */
  readonly retryAfterSeconds: number | undefined

  constructor(status: number, message: string, retryAfterSeconds?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

// --- "Oturum bitti" bildirimi -------------------------------------------------
// Herhangi bir istek 401 alırsa (ör. token süresi doldu) dinleyenlere haber verilir.
// AuthProvider dinleyip kullanıcıyı giriş ekranına döndürür. Bu, C#'taki bir event'e
// (`event Action Unauthorized`) benzer; onUnauthorized abone olur ve abonelikten
// çıkmak için bir fonksiyon döndürür (React'te effect'in "cleanup"ı olarak kullanılır).
type Listener = () => void
const unauthorizedListeners = new Set<Listener>()

export function onUnauthorized(listener: Listener): () => void {
  unauthorizedListeners.add(listener)
  return () => {
    unauthorizedListeners.delete(listener)
  }
}

/** Oturumun bittiğini dinleyenlere bildirir (HTTP 401 ya da WebSocket kapanış kodu 4401 gibi). */
export function notifyUnauthorized(): void {
  for (const listener of unauthorizedListeners) listener()
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** JSON'a çevrilip gövdeye konur. */
  body?: unknown
  /** İstek iptal edilebilsin diye (bileşen ekrandan kalkarsa yarım kalan istek bırakılır). */
  signal?: AbortSignal
  /**
   * true ise 401, global "oturum bitti" bildirimini TETİKLEMEZ. Giriş isteğinde yanlış
   * parola zaten 401'dir ve bu bir "oturum bitti" durumu değildir.
   */
  silent401?: boolean
}

/**
 * JSON konuşan istek. Başarısızlıkta ApiError fırlatır; iptal edilen istekte (AbortError)
 * orijinal hatayı olduğu gibi yeniden fırlatır (iptal bir hata sayılmaz).
 *
 * DİKKAT: `T` yalnızca DERLEME zamanında var olan bir iddiadır. C#'ta JSON, çalışma
 * zamanında belirli bir sınıfa deserialize edilir ve uyumsuzsa hata alırsın; TypeScript
 * tipleri ise çalışma zamanında silinir, sunucu farklı bir şey döndürürse kimse uyarmaz.
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
      // Oturum cookie'si (httpOnly) aynı origin'e otomatik gönderilir; JS token'ı hiç görmez.
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

/** Bir hatanın "istek iptal edildi" olup olmadığını söyler. */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}
