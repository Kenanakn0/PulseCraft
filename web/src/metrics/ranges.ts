// Detay sayfasındaki zaman aralıkları. `last`, sunucuya gönderilen süredir (Go süre biçimi);
// pencereyi SUNUCU saatine göre kurar. Sunucu ≤ 3 saatlik aralıklarda ham veriyi, daha
// uzunlarda 1 dakikalık özeti döndürür.
export const RANGES = [
  { id: '15m', label: '15 dk', last: '15m', pollMs: 10_000 },
  { id: '1h', label: '1 sa', last: '1h', pollMs: 10_000 },
  { id: '6h', label: '6 sa', last: '6h', pollMs: 60_000 }, // özet dakikada bir oluşur: sık yenilemenin anlamı yok
  { id: '24h', label: '24 sa', last: '24h', pollMs: 60_000 },
] as const

/** "15m" | "1h" | "6h" | "24h" (RANGES'ten türetilir; ikisi ayrı ayrı bakımlanmaz). */
export type RangeId = (typeof RANGES)[number]['id']

export const DEFAULT_RANGE: RangeId = '15m'

export function getRange(id: RangeId) {
  // RANGES tam olarak RangeId'leri içerdiği için bulunamama ihtimali yoktur; yine de
  // noUncheckedIndexedAccess bunu kanıtlamamızı ister.
  return RANGES.find((r) => r.id === id) ?? RANGES[0]
}

/** Adres çubuğundaki `?range=` değerini doğrular; bilinmiyorsa varsayılana düşer. */
export function parseRangeId(value: string | null): RangeId {
  return RANGES.find((r) => r.id === value)?.id ?? DEFAULT_RANGE
}
