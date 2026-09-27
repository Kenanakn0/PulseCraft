import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, isAbortError } from '../api/http'

export type Resource<T> =
  | { status: 'loading' }
  /** refreshError: a refresh after the first successful load failed; the last known data stays on screen. */
  | { status: 'ready'; data: T; refreshError: string | null }
  | { status: 'error'; message: string }

function errorMessage(err: unknown, label: string): string {
  if (err instanceof ApiError && err.status !== 0) return `${label} alınamadı (HTTP ${err.status}).`
  return 'Sunucuya ulaşılamadı.'
}

/**
 * Runs `fetcher` immediately and then every `intervalMs`. On unmount it cancels the pending request and
 * stops the timer.
 *
 * When `resyncKey` changes (e.g. the WebSocket reconnected) it refetches immediately WITHOUT going back to
 * the loading state: the last known data stays until fresh data arrives.
 *
 * A changed `fetcher` does NOT restart the effect (the latest one is kept in a ref). If what is fetched
 * changes (another server, another range), give the component a new `key` so it starts from scratch.
 */
export function usePolledResource<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  intervalMs: number,
  failureLabel: string,
  resyncKey = 0,
) {
  const [state, setState] = useState<Resource<T>>({ status: 'loading' })

  // "Try again" bumps this counter; being an effect dependency, it restarts the load.
  const [reloadCount, setReloadCount] = useState(0)

  // Holds the latest `fetcher` without triggering re-renders.
  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  })

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined

    async function load() {
      try {
        const data = await fetcherRef.current(controller.signal)
        setState({ status: 'ready', data, refreshError: null })
      } catch (err) {
        if (isAbortError(err)) return // unmounted: the result does not matter, no rescheduling
        const message = errorMessage(err, failureLabel)
        setState((current) =>
          current.status === 'ready' ? { ...current, refreshError: message } : { status: 'error', message },
        )
      }
      // Schedule the next run when this one finishes (not setInterval), so slow responses never overlap.
      timer = setTimeout(load, intervalMs)
    }
    void load()

    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [intervalMs, reloadCount, failureLabel, resyncKey])

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setReloadCount((n) => n + 1)
  }, [])

  return { state, reload }
}
