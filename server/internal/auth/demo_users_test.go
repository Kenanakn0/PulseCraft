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
		{"örnek dosyadaki yer tutucu parola", "admin@x.io:degistir_beni_123:Admin"},
		{"yer tutucu, büyük harfle", "admin@x.io:DEGISTIR_beni_456:Admin"},
		{"İngilizce yer tutucu", "admin@x.io:changeme-please:Admin"},
		{"yaygın parola", "admin@x.io:password123:Admin"},
		{"yaygın parola, büyük/küçük harf farkıyla", "admin@x.io:Demo1234:Admin"},
		{"parola e-postanın kullanıcı kısmıyla aynı", "operator@x.io:operator:Admin"},
		{"parola e-postanın kendisiyle aynı", "admin@x.io:admin@x.io:Admin"},
		{"tek karakterin tekrarı", "admin@x.io:aaaaaaaaaa:Admin"},
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

func TestParseDemoUsers_WeakPasswordErrorExplainsWithoutLeaking(t *testing.T) {
	_, err := ParseDemoUsers("a@x.io:parola12345:A;b@x.io:degistir_beni_456:B")
	if err == nil {
		t.Fatal("yer tutucu parola kabul edildi")
	}
	msg := err.Error()
	if !strings.Contains(msg, "2. kayıt") || !strings.Contains(msg, "yer tutucu") {
		t.Errorf("hata kaydı ve nedeni söylemeli, gelen: %q", msg)
	}
	if strings.Contains(msg, "degistir_beni_456") {
		t.Errorf("hata mesajı parolayı içeriyor: %q", msg)
	}
}

func TestParseDemoUsers_ErrorMentionsPosition(t *testing.T) {
	_, err := ParseDemoUsers("a@x.io:parola12345:A;b@x.io:kisa:B")
	if err == nil || !strings.Contains(err.Error(), "2. kayıt") {
		t.Errorf("hata 2. kaydı göstermeli, gelen: %v", err)
	}
}
