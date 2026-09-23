package auth

import "golang.org/x/crypto/bcrypt"

// dummyHash: kullanıcı bulunamadığında karşılaştırılan sabit sahte hash.
// Süreç başına BİR kez, gerçek kullanıcı hash'leriyle AYNI maliyetle
// (bcrypt.DefaultCost) üretilir; böylece "kullanıcı yok" ile "parola yanlış"
// yolları aynı sürede (bir bcrypt karşılaştırması) tamamlanır ve yanıt
// süresinden hangi e-postaların kayıtlı olduğu anlaşılamaz. Paket yüklenirken
// üretilir ki ilk sahte karşılaştırma ekstra süre (hash üretimi) taşımasın.
var dummyHash = mustHash("hicbir-kullaniciya-ait-olmayan-sahte-parola")

func mustHash(password string) []byte {
	h, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		panic("dummy bcrypt hash üretilemedi: " + err.Error())
	}
	return h
}

// VerifyPassword: parolayı hash ile karşılaştırır. userFound=false ise
// (kullanıcı yok) gerçek hash yerine dummyHash ile yine tam bir bcrypt
// karşılaştırması yapılır ve sonuç DAİMA false'tur.
func VerifyPassword(hash string, userFound bool, password string) bool {
	target := dummyHash
	if userFound {
		target = []byte(hash)
	}
	err := bcrypt.CompareHashAndPassword(target, []byte(password))
	return userFound && err == nil
}
