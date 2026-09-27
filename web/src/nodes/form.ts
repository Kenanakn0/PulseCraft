/** Sunucu adının en fazla karakter sayısı (sunucudaki `maxNodeNameRunes` ile aynı). */
export const MAX_NODE_NAME = 100

/**
 * Sunucu adını doğrular (sunucu da aynı kuralları uygular: kırpar, boşsa ya da 100 karakteri aşarsa 400).
 * Karakter sayısı `[...ad]` ile sayılır: "ş" gibi harfler tek karakterdir (C#'taki `string.Length` UTF-16
 * birimi sayar; burada Unicode kod noktası sayılıyor, Go'daki `utf8.RuneCountInString` gibi).
 */
export function validateNodeName(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed === '') return 'Sunucu adı zorunlu.'
  if ([...trimmed].length > MAX_NODE_NAME) return `Sunucu adı en fazla ${MAX_NODE_NAME} karakter olabilir.`
  return null
}
