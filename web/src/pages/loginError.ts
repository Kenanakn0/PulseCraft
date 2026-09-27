import { ApiError } from '../api/http'

// Messages are derived from the status code instead of showing the server's raw text, so the UI wording
// stays independent of server messages.
export function loginErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 401:
        return 'E-posta veya parola hatalı.'
      case 400:
        return 'E-posta ve parola girin.'
      case 429:
        return err.retryAfterSeconds !== undefined
          ? `Çok fazla giriş denemesi yapıldı. ${err.retryAfterSeconds} saniye sonra tekrar deneyin.`
          : 'Çok fazla giriş denemesi yapıldı. Biraz sonra tekrar deneyin.'
      case 0:
        return 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.'
    }
  }
  return 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.'
}

/**
 * Where to go after login: only an absolute in-app path is accepted (values like "//evil.example" that
 * could redirect to another site are rejected).
 */
export function safeRedirectPath(state: unknown): string {
  if (typeof state === 'object' && state !== null && 'from' in state) {
    const from = (state as { from: unknown }).from
    if (typeof from === 'string' && from.startsWith('/') && !from.startsWith('//')) return from
  }
  return '/'
}
