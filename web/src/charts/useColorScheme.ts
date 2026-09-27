import { useSyncExternalStore } from 'react'

const QUERY = '(prefers-color-scheme: dark)'

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined // environments such as jsdom
  const media = window.matchMedia(QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

function getSnapshot(): 'dark' | 'light' {
  return typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches ? 'dark' : 'light'
}

/**
 * Tracks the browser's dark/light preference and re-renders on change. Canvas charts cannot follow CSS
 * variables by themselves, hence this hook.
 */
export function useColorScheme(): 'dark' | 'light' {
  return useSyncExternalStore(subscribe, getSnapshot, () => 'light')
}
