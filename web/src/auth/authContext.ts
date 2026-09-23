import { createContext } from 'react'
import type { User } from '../api/types'

export type AuthStatus =
  /** Sayfa yeni açıldı, "oturum var mı?" sorusu (GET /auth/me) henüz yanıtlanmadı. */
  | 'loading'
  | 'authenticated'
  | 'unauthenticated'

export interface AuthState {
  status: AuthStatus
  user: User | null
  /** Oturum, kullanıcı çıkış yapmadan (ör. süre dolarak) bittiyse true: girişte açıklama gösterilir. */
  sessionExpired: boolean
}

export interface AuthContextValue extends AuthState {
  /** Başarısızlıkta ApiError fırlatır (401 yanlış parola, 429 çok fazla deneme, 0 ağ hatası…). */
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

// Context, ağaçtaki herhangi bir bileşenin "props geçmeden" ortak bir değere erişmesini sağlar.
// C# karşılığı: DI'daki scoped bir servis (Blazor'da CascadingValue). Varsayılan null: provider
// olmadan kullanılırsa useAuth bunu yakalayıp anlaşılır bir hata verir.
export const AuthContext = createContext<AuthContextValue | null>(null)
