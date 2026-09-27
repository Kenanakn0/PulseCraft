/** Maximum server name length (same as the server's `maxNodeNameRunes`). */
export const MAX_NODE_NAME = 100

/**
 * Validates a server name with the server's rules (trimmed; empty or over 100 characters is a 400).
 * Counts Unicode code points (`[...name]`), like the server's utf8.RuneCountInString, not UTF-16 units.
 */
export function validateNodeName(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed === '') return 'Sunucu adı zorunlu.'
  if ([...trimmed].length > MAX_NODE_NAME) return `Sunucu adı en fazla ${MAX_NODE_NAME} karakter olabilir.`
  return null
}
