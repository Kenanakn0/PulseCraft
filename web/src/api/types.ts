// Sunucunun JSON sözleşmesi. Alan adları sunucudakiyle (snake_case) birebir aynıdır.
// TypeScript'te `interface`, C#'taki bir DTO'ya/record'a benzer, ama YAPISALDIR: bir nesne
// bu alanlara sahipse, adı ne olursa olsun bu tipe uyar (C#'ta uyum isimle/kalıtımla olur).

export interface User {
  id: number
  email: string
  display_name: string
}

/** POST /api/v1/auth/login yanıtı. */
export interface LoginResponse {
  user: User
}

/** GET /api/v1/auth/me yanıtı. */
export interface MeResponse {
  user: User
  /** Oturumun sona ereceği an (ISO 8601). */
  expires_at: string
}
