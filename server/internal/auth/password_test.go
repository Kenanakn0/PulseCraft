package auth

import (
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestVerifyPassword(t *testing.T) {
	hash, err := bcrypt.GenerateFromPassword([]byte("dogru-parola-123"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name     string
		found    bool
		password string
		want     bool
	}{
		{"doğru parola", true, "dogru-parola-123", true},
		{"yanlış parola", true, "yanlis-parola-123", false},
		{"boş parola", true, "", false},
		{"kullanıcı yok", false, "dogru-parola-123", false},
		// Kullanıcı yokken, hash'in kendisi "doğru" parola olsa bile sonuç false.
		{"kullanıcı yok, sahte hash'in parolası", false, "hicbir-kullaniciya-ait-olmayan-sahte-parola", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := VerifyPassword(string(hash), tt.found, tt.password); got != tt.want {
				t.Errorf("VerifyPassword() = %v, beklenen %v", got, tt.want)
			}
		})
	}
}

func TestDummyHashUsesSameCostAsRealHashes(t *testing.T) {
	cost, err := bcrypt.Cost(dummyHash)
	if err != nil {
		t.Fatal(err)
	}
	// SeedUsers bcrypt.DefaultCost ile hash'ler; eşit süre için dummy de aynı olmalı.
	if cost != bcrypt.DefaultCost {
		t.Errorf("dummy hash maliyeti = %d, beklenen %d", cost, bcrypt.DefaultCost)
	}
}
