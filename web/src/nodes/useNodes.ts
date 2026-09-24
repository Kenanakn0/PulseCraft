import { useCallback, useEffect, useState } from 'react'
import { ApiError, isAbortError } from '../api/http'
import { nodesApi } from '../api/nodes'
import type { NodeSummary } from '../api/types'

/** Liste kaç ms'de bir yenilenir. */
export const NODES_POLL_MS = 10_000

export type NodesState =
  | { status: 'loading' }
  /** refreshError: liste bir kez yüklendikten sonra yapılan yenilemenin başarısız olduğunu söyler;
   *  son bilinen veriler ekranda kalır. */
  | { status: 'ready'; nodes: NodeSummary[]; refreshError: string | null }
  | { status: 'error'; message: string }

function errorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status !== 0) return `Sunucu listesi alınamadı (HTTP ${err.status}).`
  return 'Sunucuya ulaşılamadı.'
}

/**
 * ÖZEL HOOK (custom hook): durum + effect mantığını, adı `use` ile başlayan bir fonksiyona
 * çıkarıp birden çok bileşenin kullanabileceği hale getirmektir. C#'ta bunun karşılığı,
 * kendi durumunu ve yaşam döngüsünü yöneten bir servis sınıfıdır (ör. arka planda veriyi
 * periyodik yenileyen bir `IHostedService`'e benzer bir davranış), ama React'te sınıf yerine
 * bir fonksiyondur ve bileşenle birlikte doğup ölür.
 *
 * Sunucu listesini yükler ve `pollMs` aralığıyla yeniler. Bileşen ekrandan kalkınca hem
 * bekleyen isteği iptal eder hem de zamanlayıcıyı durdurur (bkz. effect'in cleanup'ı).
 */
export function useNodes(pollMs: number = NODES_POLL_MS) {
  const [state, setState] = useState<NodesState>({ status: 'loading' })

  // "Yeniden dene" düğmesi bu sayacı artırır; sayaç effect'in bağımlılığı olduğu için
  // effect temizlenip baştan çalışır (yani yükleme yeniden başlar).
  const [reloadCount, setReloadCount] = useState(0)

  useEffect(() => {
    // AbortController ≈ C#'taki CancellationTokenSource: signal'i isteğe verilir, abort()
    // çağrılınca bekleyen fetch iptal edilir.
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined

    async function load() {
      try {
        const nodes = await nodesApi.list(controller.signal)
        setState({ status: 'ready', nodes, refreshError: null })
      } catch (err) {
        if (isAbortError(err)) return // bileşen kalktı; sonuç artık önemsiz, yeniden planlama yok
        const message = errorMessage(err)
        // Daha önce yüklenmişse verileri koru, yalnızca uyarı göster; hiç yüklenmemişse hata ekranı.
        setState((current) =>
          current.status === 'ready' ? { ...current, refreshError: message } : { status: 'error', message },
        )
      }
      // setInterval yerine "iş bitince bir sonrakini planla" (özyinelemeli setTimeout): yavaş bir
      // yanıt yüzünden istekler üst üste binmez.
      timer = setTimeout(load, pollMs)
    }
    void load()

    // CLEANUP: effect yeniden çalışmadan önce ve bileşen kalkarken çağrılır (C#'ta Dispose).
    // Bunu yazmazsan bileşen kaybolduktan sonra da istekler sürer ve state güncellenmeye çalışılır.
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [pollMs, reloadCount])

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setReloadCount((n) => n + 1)
  }, [])

  return { state, reload }
}
