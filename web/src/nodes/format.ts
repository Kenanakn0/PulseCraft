import type { NodeSummary } from '../api/types'

const percentFormat = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** 42.5 → "42,5 %" (Türkçe ondalık ayracı). */
export function formatPercent(value: number): string {
  return `${percentFormat.format(value)} %`
}

/**
 * Sunucunun bildirdiği "son görülmeden bu yana geçen saniye"yi okunur metne çevirir.
 * Süre SUNUCUDA hesaplanır (tarayıcı saati kullanılmaz), burada yalnızca biçimlenir.
 */
export function formatAge(seconds: number | null): string {
  if (seconds === null) return 'hiç görülmedi'
  if (seconds < 5) return 'az önce'
  if (seconds < 60) return `${Math.floor(seconds)} sn önce`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} dk önce`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} sa önce`
  return `${Math.floor(seconds / 86400)} gün önce`
}

/**
 * Çevrimiçi olanlar önce, kendi içinde ada göre (Türkçe sıralama). Diziyi DEĞİŞTİRMEZ,
 * sıralı bir KOPYA döndürür: React'te state/props olarak gelen dizi yerinde değiştirilmemelidir
 * (C#'ta `list.OrderBy(...)` yeni bir dizi üretir, `list.Sort()` ise yerinde değiştirir; burada
 * OrderBy gibi davranmamız gerekir).
 */
export function sortNodes(nodes: readonly NodeSummary[]): NodeSummary[] {
  return [...nodes].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1
    return a.name.localeCompare(b.name, 'tr')
  })
}
