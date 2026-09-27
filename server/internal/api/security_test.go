package api

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestCrossOriginProtection(t *testing.T) {
	a := newFullAPI(t, time.Hour)
	router := a.Routes()
	session := &http.Cookie{Name: sessionCookieName, Value: issue(t, a, 1)}

	tests := []struct {
		name     string
		method   string
		path     string
		body     string
		header   map[string]string
		cookie   *http.Cookie
		wantCode int
	}{
		{
			name: "başka siteden login", method: http.MethodPost, path: "/api/v1/auth/login", body: `{}`,
			header: map[string]string{"Sec-Fetch-Site": "cross-site"}, wantCode: http.StatusForbidden,
		},
		{
			// SameSite=Strict bu isteğe cookie'yi EKLER; koruma yine de reddetmeli.
			name: "aynı sitedeki başka origin'den oturumlu ack", method: http.MethodPost, path: "/api/v1/alerts/1/ack",
			header: map[string]string{"Sec-Fetch-Site": "same-site"}, cookie: session, wantCode: http.StatusForbidden,
		},
		{
			name: "Sec-Fetch-Site yok, Origin başka port", method: http.MethodPost, path: "/api/v1/auth/login", body: `{}`,
			header: map[string]string{"Origin": "http://localhost:3000"}, wantCode: http.StatusForbidden,
		},
		{
			name: "aynı origin'den login (tarayıcı)", method: http.MethodPost, path: "/api/v1/auth/login", body: `{}`,
			header: map[string]string{"Sec-Fetch-Site": "same-origin", "Origin": "http://localhost:8080"}, wantCode: http.StatusBadRequest,
		},
		{
			name: "Sec-Fetch-Site yok, Origin istek Host'uyla aynı", method: http.MethodPost, path: "/api/v1/auth/login", body: `{}`,
			header: map[string]string{"Origin": "http://localhost:8080"}, wantCode: http.StatusBadRequest,
		},
		{
			// Agent tarayıcı başlıkları göndermez: kendi (API key) kimlik doğrulamasına ulaşmalı.
			name: "agent ölçüm gönderimi", method: http.MethodPost, path: "/api/v1/metrics", body: `{"samples":[]}`,
			header: map[string]string{"User-Agent": "Go-http-client/1.1"}, wantCode: http.StatusUnauthorized,
		},
		{
			name: "başka siteden GET engellenmez (durum değiştirmez)", method: http.MethodGet, path: "/api/v1/auth/me",
			header: map[string]string{"Sec-Fetch-Site": "cross-site"}, wantCode: http.StatusUnauthorized,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, "http://localhost:8080"+tt.path, strings.NewReader(tt.body))
			for k, v := range tt.header {
				req.Header.Set(k, v)
			}
			if tt.cookie != nil {
				req.AddCookie(tt.cookie)
			}
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			if rec.Code != tt.wantCode {
				t.Fatalf("kod = %d (%q), beklenen %d", rec.Code, strings.TrimSpace(rec.Body.String()), tt.wantCode)
			}
			if tt.wantCode == http.StatusForbidden && !strings.Contains(rec.Body.String(), "çapraz kaynaklı") {
				t.Errorf("gövde = %q, çapraz kaynak mesajı bekleniyordu", rec.Body.String())
			}
		})
	}
}

func TestLimitBody(t *testing.T) {
	var readErr error
	h := limitBody(10)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, readErr = io.ReadAll(r.Body)
	}))

	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/", strings.NewReader("0123456789")))
	if readErr != nil {
		t.Fatalf("sınırdaki gövde okunamadı: %v", readErr)
	}

	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/", strings.NewReader("0123456789x")))
	var tooLarge *http.MaxBytesError
	if !errors.As(readErr, &tooLarge) {
		t.Fatalf("sınırı aşan gövdede MaxBytesError bekleniyordu, gelen: %v", readErr)
	}
}
