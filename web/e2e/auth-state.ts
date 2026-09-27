// Oturum durumu (çerez) dosyaları: `auth.setup.ts` her kullanıcı için TEK kez gerçek giriş yapıp bunları yazar,
// spec dosyaları kendi girişlerini yapmak yerine bunları okur. Neden: giriş ucu IP başına dakikada 10 denemeyle
// sınırlı; her dosyanın kendi girişini yapması tam paket koşusunda sınırı aşıyordu (CI'da sahte başarısızlık).
// Dosyalar oturum çerezi içerir → `.gitignore`'da (e2e/.auth/).
export const USER1_STATE = 'e2e/.auth/user1.json'
export const USER2_STATE = 'e2e/.auth/user2.json'

export const hasUser1 = Boolean(process.env.E2E_EMAIL && process.env.E2E_PASSWORD)
export const hasUser2 = Boolean(process.env.E2E_EMAIL2 && process.env.E2E_PASSWORD2)
