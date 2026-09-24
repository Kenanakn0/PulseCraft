import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, isAbortError } from '../api/http'

export type Resource<T> =
  | { status: 'loading' }
  /** refreshError: veri bir kez yüklendikten sonra yapılan yenilemenin başarısız olduğunu söyler;
   *  son bilinen veri ekranda kalır. */
  | { status: 'ready'; data: T; refreshError: string | null }
  | { status: 'error'; message: string }

function errorMessage(err: unknown, label: string): string {
  if (err instanceof ApiError && err.status !== 0) return `${label} alınamadı (HTTP ${err.status}).`
  return 'Sunucuya ulaşılamadı.'
}

/**
 * GENEL (generic) ÖZEL HOOK: verilen `fetcher`'ı hemen çalıştırır ve `intervalMs` aralığıyla
 * tekrarlar. `T`, çekilen verinin tipidir (C#'taki `Task<T>` / `IAsyncEnumerable<T>` gibi genel tip
 * parametresi). Bileşen ekrandan kalkınca hem bekleyen isteği iptal eder hem zamanlayıcıyı durdurur.
 *
 * ÖNEMLİ: `fetcher` değişse de effect YENİDEN BAŞLAMAZ (en son hâli bir ref'te tutulur). Hangi
 * veriyi çektiğin değişiyorsa (ör. başka bir sunucu, başka aralık) bileşene değişen bir `key`
 * ver: React bileşeni sıfırdan kurar ve durum temiz başlar (C#'ta yeni bir bileşen örneği).
 */
export function usePolledResource<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  intervalMs: number,
  failureLabel: string,
) {
  const [state, setState] = useState<Resource<T>>({ status: 'loading' })

  // "Yeniden dene" düğmesi bu sayacı artırır; sayaç effect'in bağımlılığı olduğu için yükleme baştan başlar.
  const [reloadCount, setReloadCount] = useState(0)

  // REF (`useRef`): değişince ekranı YENİDEN ÇİZMEYEN, çizimler arasında yaşayan bir kutu.
  // C#'ta sıradan bir alan gibi düşünülebilir. Burada en güncel `fetcher`'ı taşır.
  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  })

  useEffect(() => {
    const controller = new AbortController() // ≈ CancellationTokenSource
    let timer: ReturnType<typeof setTimeout> | undefined

    async function load() {
      try {
        const data = await fetcherRef.current(controller.signal)
        setState({ status: 'ready', data, refreshError: null })
      } catch (err) {
        if (isAbortError(err)) return // bileşen kalktı: sonuç önemsiz, yeniden planlama yok
        const message = errorMessage(err, failureLabel)
        setState((current) =>
          current.status === 'ready' ? { ...current, refreshError: message } : { status: 'error', message },
        )
      }
      // setInterval yerine "iş bitince bir sonrakini planla": yavaş yanıtta istekler üst üste binmez.
      timer = setTimeout(load, intervalMs)
    }
    void load()

    // CLEANUP (C#'ta Dispose): effect yeniden çalışmadan önce ve bileşen kalkarken çağrılır.
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [intervalMs, reloadCount, failureLabel])

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setReloadCount((n) => n + 1)
  }, [])

  return { state, reload }
}
