package auth

import (
	"context"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

const (
	minPasswordLen   = 8
	maxPasswordBytes = 72 // bcrypt sadece ilk 72 baytı kullanır
)

// DemoUser: .env'deki DEMO_USERS değişkeninden gelen bir kullanıcı.
type DemoUser struct {
	Email       string
	Password    string
	DisplayName string
}

// ParseDemoUsers: "e-posta:parola:görünen ad;e-posta2:parola2:ad2" biçimini
// ayrıştırır. Kullanıcılar ';' ile ayrılır; her kayıt İLK İKİ ':' karakterinden
// bölünür (strings.SplitN ile 3 parça), yani görünen ad ':' içerebilir.
//
// Kısıtlar (deploy/.env.example'da da yazılı): e-posta ve parola ':' veya ';'
// içeremez, görünen ad ';' içeremez. Parola içindeki ':' sessizce yanlış
// bölünürdü — bu yüzden bu kısıt kullanıcıya belgelenmiştir.
//
// Hata mesajlarında parola ASLA yer almaz. Boş girdi hata değildir (kullanıcı yok).
func ParseDemoUsers(raw string) ([]DemoUser, error) {
	var users []DemoUser
	seen := make(map[string]bool)

	n := 0 // boş olmayan kayıtların sırası (hata mesajları için)
	for _, entry := range strings.Split(raw, ";") {
		if strings.TrimSpace(entry) == "" {
			continue
		}
		n++

		parts := strings.SplitN(entry, ":", 3)
		if len(parts) != 3 {
			return nil, fmt.Errorf("DEMO_USERS: %d. kayıt 'e-posta:parola:görünen ad' biçiminde olmalı", n)
		}

		email := strings.ToLower(strings.TrimSpace(parts[0]))
		password := parts[1] // olduğu gibi: baştaki/sondaki boşluk parolanın parçasıdır
		display := strings.TrimSpace(parts[2])

		if at := strings.Index(email, "@"); at <= 0 || at == len(email)-1 || strings.ContainsAny(email, " \t") {
			return nil, fmt.Errorf("DEMO_USERS: %d. kayıtta geçerli bir e-posta yok", n)
		}
		if utf8.RuneCountInString(password) < minPasswordLen {
			return nil, fmt.Errorf("DEMO_USERS: %d. kayıtta parola en az %d karakter olmalı", n, minPasswordLen)
		}
		if len(password) > maxPasswordBytes {
			return nil, fmt.Errorf("DEMO_USERS: %d. kayıtta parola en fazla %d bayt olabilir (bcrypt sınırı)", n, maxPasswordBytes)
		}
		if reason := weakPasswordReason(email, password); reason != "" {
			return nil, fmt.Errorf("DEMO_USERS: %d. kayıttaki parola kabul edilmedi: %s", n, reason)
		}
		if display == "" {
			return nil, fmt.Errorf("DEMO_USERS: %d. kayıtta görünen ad boş olamaz", n)
		}
		if seen[email] {
			return nil, fmt.Errorf("DEMO_USERS: %d. kayıttaki e-posta daha önce de tanımlanmış", n)
		}
		seen[email] = true

		users = append(users, DemoUser{Email: email, Password: password, DisplayName: display})
	}
	return users, nil
}

// placeholderMarkers appear in the example .env; a stack started with an unedited copy
// would otherwise run with passwords that are published in the repository.
var placeholderMarkers = []string{"degistir", "changeme", "change_me", "change-me"}

var commonPasswords = map[string]bool{
	"password": true, "password1": true, "password123": true, "passw0rd": true,
	"12345678": true, "123456789": true, "1234567890": true, "87654321": true,
	"11111111": true, "00000000": true, "abcdefgh": true, "abcd1234": true,
	"qwertyui": true, "qwerty123": true, "qwertyuiop": true, "iloveyou": true,
	"letmein1": true, "welcome1": true, "admin123": true, "admin1234": true,
	"demo1234": true, "test1234": true, "parola123": true, "sifre123": true,
	"şifre123": true, "pulsecraft": true,
}

// weakPasswordReason returns why a demo password is refused, or "" if it is acceptable.
// The reason never contains the password itself.
func weakPasswordReason(email, password string) string {
	lower := strings.ToLower(password)
	for _, m := range placeholderMarkers {
		if strings.Contains(lower, m) {
			return "örnek dosyadaki yer tutucu parola"
		}
	}
	if commonPasswords[lower] {
		return "çok yaygın bir parola"
	}
	if local, _, _ := strings.Cut(email, "@"); lower == local || lower == email {
		return "e-posta adresiyle aynı"
	}
	if first, _ := utf8.DecodeRuneInString(password); strings.Count(password, string(first)) == utf8.RuneCountInString(password) {
		return "tek bir karakterin tekrarı"
	}
	return ""
}

// SeedUsers: demo kullanıcıları users tablosuna ekler ya da günceller.
// .env kaynak kabul edilir: e-posta zaten varsa parola hash'i ve görünen ad
// .env'dekiyle değiştirilir. .env'de olmayan kullanıcılara dokunulmaz.
//
// ON CONFLICT (lower(email)), şemadaki ux_users_email ifade indeksiyle eşleşir.
func SeedUsers(ctx context.Context, db *pgxpool.Pool, users []DemoUser) error {
	for _, u := range users {
		hash, err := bcrypt.GenerateFromPassword([]byte(u.Password), bcrypt.DefaultCost)
		if err != nil {
			return fmt.Errorf("%s için parola hash'lenemedi: %w", u.Email, err)
		}

		_, err = db.Exec(ctx,
			`INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3)
			 ON CONFLICT (lower(email)) DO UPDATE
			 SET password_hash = EXCLUDED.password_hash, display_name = EXCLUDED.display_name`,
			u.Email, string(hash), u.DisplayName)
		if err != nil {
			return fmt.Errorf("%s kaydedilemedi: %w", u.Email, err)
		}
	}
	return nil
}
