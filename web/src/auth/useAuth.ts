import { useContext } from 'react'
import { AuthContext, type AuthContextValue } from './authContext'

// "Hook": adı `use` ile başlayan, React'in özelliklerini (state, context, effect…) kullanan
// fonksiyon. Yalnızca bileşenlerin ya da başka hook'ların en üst düzeyinde çağrılabilir
// (koşul/döngü içinde değil). C#'ta DI'dan servis istemeye (`@inject`) en yakın şey budur.
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (value === null) {
    throw new Error('useAuth yalnızca <AuthProvider> içinde kullanılabilir')
  }
  return value
}
