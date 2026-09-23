package auth

import (
	"reflect"
	"strings"
	"testing"
)

func TestParseDemoUsers_Valid(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want []DemoUser
	}{
		{"boş girdi kullanıcı yok demektir", "", nil},
		{"sadece boşluk ve ayraç", " ; ;; ", nil},
		{
			"tek kullanıcı",
			"admin@pulsecraft.local:parola12345:Admin",
			[]DemoUser{{"admin@pulsecraft.local", "parola12345", "Admin"}},
		},
		{
			"iki kullanıcı, e-posta küçük harfe çevrilir, kenar boşlukları kırpılır",
			" Admin@PulseCraft.Local :parola12345: Admin ; ops@pulsecraft.local:baska-parola:Operatör ;",
			[]DemoUser{
				{"admin@pulsecraft.local", "parola12345", "Admin"},
				{"ops@pulsecraft.local", "baska-parola", "Operatör"},
			},
		},
		{
			"görünen ad ':' içerebilir (ilk iki ':'den bölünür)",
			"ops@x.io:parola12345:Gece: Vardiyası",
			[]DemoUser{{"ops@x.io", "parola12345", "Gece: Vardiyası"}},
		},
		{
			"paroladaki boşluk olduğu gibi korunur",
			"a@b.io: sifre 12345 :Ad",
			[]DemoUser{{"a@b.io", " sifre 12345 ", "Ad"}},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseDemoUsers(tt.raw)
			if err != nil {
				t.Fatalf("beklenmeyen hata: %v", err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("ParseDemoUsers() = %#v, beklenen %#v", got, tt.want)
			}
		})
	}
}

func TestParseDemoUsers_Invalid(t *testing.T) {
	tests := []struct {
		name string
		raw  string
	}{
		{"parça eksik (sadece e-posta)", "admin@x.io"},
		{"parça eksik (ad yok)", "admin@x.io:parola12345"},
		{"e-posta @ içermiyor", "admin:parola12345:Admin"},
		{"e-posta @ ile başlıyor", "@x.io:parola12345:Admin"},
		{"e-posta @ ile bitiyor", "admin@:parola12345:Admin"},
		{"e-postada boşluk", "ad min@x.io:parola12345:Admin"},
		{"parola çok kısa", "admin@x.io:kisa:Admin"},
		{"parola bcrypt sınırından uzun", "admin@x.io:" + strings.Repeat("p", 73) + ":Admin"},
		{"görünen ad boş", "admin@x.io:parola12345: "},
		{"aynı e-posta (büyük/küçük harf farkıyla) iki kez", "a@x.io:parola12345:A;A@X.io:parola67890:B"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseDemoUsers(tt.raw)
			if err == nil {
				t.Fatalf("hata beklenirken sonuç döndü: %#v", got)
			}
			// Hata mesajı asla parolayı sızdırmamalı.
			for _, part := range strings.Split(tt.raw, ":") {
				if len(part) >= 8 && strings.Contains(err.Error(), part) {
					t.Errorf("hata mesajı parolayı içeriyor: %q", err)
				}
			}
		})
	}
}

func TestParseDemoUsers_ErrorMentionsPosition(t *testing.T) {
	_, err := ParseDemoUsers("a@x.io:parola12345:A;b@x.io:kisa:B")
	if err == nil || !strings.Contains(err.Error(), "2. kayıt") {
		t.Errorf("hata 2. kaydı göstermeli, gelen: %v", err)
	}
}
