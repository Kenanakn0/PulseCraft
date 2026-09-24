import { useSyncExternalStore } from 'react'

const QUERY = '(prefers-color-scheme: dark)'

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined // jsdom gibi ortamlar
  const media = window.matchMedia(QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

function getSnapshot(): 'dark' | 'light' {
  return typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches ? 'dark' : 'light'
}

/**
 * Tarayıcının koyu/açık tema ayarını izler; ayar DEĞİŞİNCE bileşen kendiliğinden yeniden çizilir.
 *
 * `useSyncExternalStore`: React'in DIŞINDAKİ bir kaynağa (burada `matchMedia`) abone olmanın
 * standart yolu. `subscribe` bir olaya abone olur ve abonelikten çıkan bir fonksiyon döndürür
 * (C#'ta `event += handler` / `event -= handler`); `getSnapshot` o anki değeri okur.
 * Canvas'a çizilen grafikler CSS değişkenlerini kendiliğinden izleyemediği için buna ihtiyaç var.
 */
export function useColorScheme(): 'dark' | 'light' {
  return useSyncExternalStore(subscribe, getSnapshot, () => 'light')
}
