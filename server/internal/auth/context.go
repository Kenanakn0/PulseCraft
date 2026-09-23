package auth

import "context"

// ctxKey: context değerleri için özel tip; başka paketlerin anahtarlarıyla
// çakışmayı önler (C#'ta HttpContext.Items'a benzer, ama tip güvenli anahtarla).
type ctxKey struct{}

// WithClaims: oturum bilgisini context'e koyar (middleware kullanır).
func WithClaims(ctx context.Context, c *Claims) context.Context {
	return context.WithValue(ctx, ctxKey{}, c)
}

// ClaimsFromContext: middleware'in koyduğu oturum bilgisini okur.
func ClaimsFromContext(ctx context.Context) (*Claims, bool) {
	c, ok := ctx.Value(ctxKey{}).(*Claims)
	return c, ok
}
