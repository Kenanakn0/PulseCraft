import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { authApi } from '../api/auth'
import { isAbortError, onUnauthorized } from '../api/http'
import { AuthContext, type AuthContextValue, type AuthState } from './authContext'

const UNAUTHENTICATED: AuthState = { status: 'unauthenticated', user: null, sessionExpired: false }

export function AuthProvider({ children }: { children: ReactNode }) {
  // STATE: değişince bileşenin YENİDEN ÇİZİLMESİNİ (fonksiyonun tekrar çalışmasını)
  // sağlayan değer. `setState` çağırmak C#/Blazor'daki alanı değiştirip StateHasChanged()
  // çağırmaya denk gelir; React bunu otomatik yapar. State'i YERİNDE değiştirmezsin
  // (state.user = x yazmak çalışmaz), her zaman YENİ bir nesne verirsin (C#'ta `with`).
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null, sessionExpired: false })

  // EFFECT: bileşen ekrana çizildikten SONRA çalışan yan etki (istek atmak, abonelik kurmak).
  // Köşeli parantez `[]` "bağımlılık listesi": boş olduğu için yalnızca ilk çizimde çalışır.
  // Döndürülen fonksiyon (cleanup) bileşen ekrandan kalkarken çalışır: C#'taki Dispose gibi.
  //
  // Geliştirme modunda <StrictMode> her effect'i BİLEREK iki kez çalıştırır (kur → temizle →
  // kur); cleanup'ı yanlış yazdıysan hemen ortaya çıksın diye. İlk çalıştırmanın isteği
  // burada abort() ile iptal edilir, yani sunucuya iki istek gider ama sonuç yalnızca bir kez
  // state'e yazılır.
  useEffect(() => {
    const controller = new AbortController()

    authApi.me(controller.signal).then(
      (me) => setState({ status: 'authenticated', user: me.user, sessionExpired: false }),
      (err: unknown) => {
        if (isAbortError(err)) return // bileşen kalktı, sonuç artık önemsiz
        // 401 (oturum yok) beklenen durumdur; ağ hatasında da giriş ekranı gösterilir.
        setState(UNAUTHENTICATED)
      },
    )

    return () => controller.abort()
  }, [])

  // Uygulamanın başka bir yerindeki bir istek 401 alırsa (token süresi doldu ya da logout
  // başka sekmede yapıldı) kullanıcıyı giriş ekranına döndür. onUnauthorized abonelikten
  // çıkan bir fonksiyon döndürdüğü için doğrudan cleanup olarak verilebilir.
  useEffect(
    () =>
      onUnauthorized(() =>
        setState((current) =>
          current.status === 'authenticated' ? { ...UNAUTHENTICATED, sessionExpired: true } : current,
        ),
      ),
    [],
  )

  // useCallback: fonksiyonun kimliğini (referansını) yeniden çizimler arasında sabit tutar.
  // Aşağıdaki useMemo'nun bağımlılığı olduğu için gerekli; aksi halde her çizimde "yeni" bir
  // context değeri oluşup tüketen tüm bileşenler gereksiz yere yeniden çizilirdi.
  const login = useCallback(async (email: string, password: string) => {
    const response = await authApi.login(email, password)
    setState({ status: 'authenticated', user: response.user, sessionExpired: false })
  }, [])

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } catch {
      // Sunucuya ulaşılamasa bile yerel oturum durumu temizlenir (en iyi çaba). Sunucudaki
      // token, süresi dolana dek geçerli kalabilir; bu bilinen bir sınırlamadır.
    }
    setState(UNAUTHENTICATED)
  }, [])

  // useMemo: değeri yalnızca bağımlılıkları değişince yeniden hesaplar.
  const value = useMemo<AuthContextValue>(() => ({ ...state, login, logout }), [state, login, logout])

  return <AuthContext value={value}>{children}</AuthContext>
}
