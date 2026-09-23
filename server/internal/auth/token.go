package auth

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// TokenTTL: oturum token'ının ömrü.
const TokenTTL = 8 * time.Hour

// User: token'a yazılan kullanıcı bilgisi.
type User struct {
	ID          int64
	Email       string
	DisplayName string
}

// Claims: JWT içeriği. Kullanıcı bilgileri token'da taşınır; böylece her
// istekte DB'ye gitmeye gerek kalmaz (bedeli: görünen ad değişirse yeni giriş
// yapılana dek eski kalır). ID alanı jti'dir ve logout'ta denylist'e yazılır.
type Claims struct {
	UserID int64  `json:"uid"`
	Email  string `json:"email"`
	Name   string `json:"name"`
	jwt.RegisteredClaims
}

// TokenService: JWT üretir ve doğrular (HS256).
type TokenService struct {
	secret []byte
	ttl    time.Duration
	now    func() time.Time // testlerde sahte saat verebilmek için
}

func NewTokenService(secret string, ttl time.Duration) *TokenService {
	return &TokenService{secret: []byte(secret), ttl: ttl, now: time.Now}
}

// Issue: kullanıcı için imzalı bir token üretir.
func (s *TokenService) Issue(u User) (string, *Claims, error) {
	jti, err := newJTI()
	if err != nil {
		return "", nil, err
	}

	now := s.now()
	claims := &Claims{
		UserID: u.ID,
		Email:  u.Email,
		Name:   u.DisplayName,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        jti,
			Subject:   strconv.FormatInt(u.ID, 10),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(s.ttl)),
		},
	}

	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(s.secret)
	if err != nil {
		return "", nil, fmt.Errorf("token imzalanamadı: %w", err)
	}
	return signed, claims, nil
}

// Parse: token'ın imzasını ve süresini doğrular.
//
// WithValidMethods: yalnızca HS256 kabul edilir. Bu olmadan saldırgan başlıktaki
// "alg" alanını değiştirerek ("none" ya da başka bir algoritma) doğrulamayı
// atlatmayı deneyebilir (algorithm confusion).
func (s *TokenService) Parse(tokenString string) (*Claims, error) {
	claims := &Claims{}
	_, err := jwt.ParseWithClaims(tokenString, claims,
		func(*jwt.Token) (any, error) { return s.secret, nil },
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithExpirationRequired(),
		jwt.WithTimeFunc(s.now),
	)
	if err != nil {
		return nil, err
	}
	if claims.ID == "" || claims.UserID == 0 {
		return nil, errors.New("token eksik alan içeriyor (jti/uid)")
	}
	return claims, nil
}

// newJTI: 128 bit kriptografik rastgele token kimliği.
func newJTI() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("jti üretilemedi: %w", err)
	}
	return hex.EncodeToString(b), nil
}
