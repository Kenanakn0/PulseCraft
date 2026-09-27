package auth

import "golang.org/x/crypto/bcrypt"

// dummyHash is compared when the user does not exist. It has the same cost as real hashes, so "no such
// user" and "wrong password" take the same time and the response time does not reveal which e-mail
// addresses exist. It is generated at package load so the first dummy comparison is not slower.
var dummyHash = mustHash("hicbir-kullaniciya-ait-olmayan-sahte-parola")

func mustHash(password string) []byte {
	h, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		panic("dummy bcrypt hash üretilemedi: " + err.Error())
	}
	return h
}

// VerifyPassword always does a full bcrypt comparison; without a user it uses dummyHash and returns false.
func VerifyPassword(hash string, userFound bool, password string) bool {
	target := dummyHash
	if userFound {
		target = []byte(hash)
	}
	err := bcrypt.CompareHashAndPassword(target, []byte(password))
	return userFound && err == nil
}
