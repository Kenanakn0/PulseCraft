import { ApiError } from '../api/http'

// Sunucunun ham hata metnini kullanıcıya göstermek yerine durum koduna göre kendi
// mesajlarımızı üretiriz: arayüz metni sunucu metinlerinden bağımsız kalır.
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
 * Girişten sonra dönülecek yol: yalnızca uygulama İÇİ, mutlak bir yol kabul edilir
 * ("//evil.example" gibi başka siteye yönlendirebilecek değerler reddedilir).
 */
export function safeRedirectPath(state: unknown): string {
  if (typeof state === 'object' && state !== null && 'from' in state) {
    const from = (state as { from: unknown }).from
    if (typeof from === 'string' && from.startsWith('/') && !from.startsWith('//')) return from
  }
  return '/'
}
