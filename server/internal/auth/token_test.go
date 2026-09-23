package auth

import (
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const testSecret = "test-icin-yeterince-uzun-bir-gizli-anahtar-1234"

var testUser = User{ID: 7, Email: "admin@pulsecraft.local", DisplayName: "Admin"}

func TestToken_RoundTrip(t *testing.T) {
	s := NewTokenService(testSecret, time.Hour)

	tok, issued, err := s.Issue(testUser)
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.Parse(tok)
	if err != nil {
		t.Fatalf("geçerli token reddedildi: %v", err)
	}

	if got.UserID != 7 || got.Email != testUser.Email || got.Name != "Admin" {
		t.Errorf("claims yanlış: %+v", got)
	}
	if got.ID == "" || got.ID != issued.ID {
		t.Errorf("jti boş ya da tutarsız: %q / %q", got.ID, issued.ID)
	}
}

func TestToken_UniqueJTI(t *testing.T) {
	s := NewTokenService(testSecret, time.Hour)
	seen := map[string]bool{}
	for i := 0; i < 50; i++ {
		_, c, err := s.Issue(testUser)
		if err != nil {
			t.Fatal(err)
		}
		if seen[c.ID] {
			t.Fatalf("jti tekrarlandı: %s", c.ID)
		}
		seen[c.ID] = true
	}
}

func TestToken_Expiry(t *testing.T) {
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	s := NewTokenService(testSecret, time.Hour)
	s.now = func() time.Time { return now }

	tok, _, err := s.Issue(testUser)
	if err != nil {
		t.Fatal(err)
	}

	s.now = func() time.Time { return now.Add(59 * time.Minute) }
	if _, err := s.Parse(tok); err != nil {
		t.Errorf("süresi dolmamış token reddedildi: %v", err)
	}

	s.now = func() time.Time { return now.Add(61 * time.Minute) }
	if _, err := s.Parse(tok); err == nil {
		t.Error("süresi dolmuş token kabul edildi")
	}
}

func TestToken_Rejected(t *testing.T) {
	s := NewTokenService(testSecret, time.Hour)
	good, _, _ := s.Issue(testUser)

	// Yanlış anahtarla imzalanmış.
	other := NewTokenService("baska-bir-gizli-anahtar-en-az-32-karakter-uzun", time.Hour)
	forged, _, _ := other.Issue(testUser)

	// İçeriği değiştirilmiş (imza artık uymaz): payload'daki bir harf değişir.
	parts := strings.Split(good, ".")
	tampered := parts[0] + "." + flipChar(parts[1]) + "." + parts[2]

	// exp alanı olmayan token.
	noExp, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"jti": "x", "uid": 7}).SignedString([]byte(testSecret))

	// alg=none saldırısı.
	none, _ := jwt.NewWithClaims(jwt.SigningMethodNone, jwt.MapClaims{
		"jti": "x", "uid": 7, "exp": time.Now().Add(time.Hour).Unix(),
	}).SignedString(jwt.UnsafeAllowNoneSignatureType)

	// Aynı anahtarla ama farklı algoritma (HS512): yalnızca HS256 kabul edilmeli.
	hs512, _ := jwt.NewWithClaims(jwt.SigningMethodHS512, jwt.MapClaims{
		"jti": "x", "uid": 7, "exp": time.Now().Add(time.Hour).Unix(),
	}).SignedString([]byte(testSecret))

	// jti / uid eksik.
	noJTI, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"exp": time.Now().Add(time.Hour).Unix(),
	}).SignedString([]byte(testSecret))

	tests := map[string]string{
		"yanlış anahtar":  forged,
		"değiştirilmiş":   tampered,
		"exp yok":         noExp,
		"alg=none":        none,
		"HS512":           hs512,
		"jti/uid eksik":   noJTI,
		"boş":             "",
		"anlamsız":        "bu.bir.token.degil",
		"tek parça":       "abc",
		"imzası silinmiş": parts[0] + "." + parts[1] + ".",
	}
	for name, tok := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := s.Parse(tok); err == nil {
				t.Errorf("token kabul edilmemeliydi: %q", name)
			}
		})
	}
}

// flipChar: base64 metnindeki ilk harfi başka bir harfle değiştirir.
func flipChar(s string) string {
	if s[0] == 'A' {
		return "B" + s[1:]
	}
	return "A" + s[1:]
}
