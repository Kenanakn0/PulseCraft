package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/go-chi/chi/v5"

	"github.com/Kenanakn0/pulsecraft/server/internal/auth"
	"github.com/Kenanakn0/pulsecraft/server/internal/clientip"
	"github.com/Kenanakn0/pulsecraft/server/internal/realtime"
)

// newFullAPI: gerçek Routes() ağacını, DB'siz kurar. Oturum kontrolü handler'lardan
// ÖNCE çalıştığı için, oturumsuz istekler DB'ye hiç ulaşmaz.
func newFullAPI(t *testing.T, ttl time.Duration) *API {
	t.Helper()
	return &API{
		Hub:          realtime.NewHub(nil),
		Tokens:       auth.NewTokenService(apiTestSecret, ttl),
		Denylist:     auth.NewDenylist(),
		LoginLimiter: auth.NewRateLimiter(10, time.Minute),
		ClientIP:     clientip.New(nil),
	}
}

// Oturum GEREKTİRMEYEN, bilerek açık bırakılan tek route'lar.
var publicRoutes = map[string]bool{
	"GET /healthz":             true,
	"POST /api/v1/auth/login":  true,
	"POST /api/v1/auth/logout": true,
	"POST /api/v1/metrics":     true, // agent, node API key'iyle (Bearer) kimlik doğrular
}

// Bu test, Routes() ağacındaki HER route'u dolaşır: açıkça public listesinde
// olmayan her route oturumsuz istekte 401 dönmek zorundadır. Böylece ileride
// eklenen bir route'u korumasız bırakmak testi kırar.
func TestRoutes_OnlyExplicitlyPublicOnesSkipSession(t *testing.T) {
	a := newFullAPI(t, time.Hour)
	router := a.Routes()

	var protected, public int
	err := chi.Walk(router, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		key := method + " " + route
		if publicRoutes[key] {
			public++
			return nil
		}
		protected++

		path := strings.ReplaceAll(route, "{id}", "1")
		for name, cookie := range map[string]*http.Cookie{
			"cookie yok":   nil,
			"bozuk cookie": {Name: sessionCookieName, Value: "bozuk.token.degeri"},
			"boş cookie":   {Name: sessionCookieName, Value: ""},
		} {
			req := httptest.NewRequest(method, path, nil)
			if cookie != nil {
				req.AddCookie(cookie)
			}
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			if rec.Code != http.StatusUnauthorized || !strings.Contains(rec.Body.String(), "oturum gerekli") {
				t.Errorf("%s (%s): kod = %d, gövde = %q; oturum istemeli (401 'oturum gerekli')",
					key, name, rec.Code, strings.TrimSpace(rec.Body.String()))
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	// Testin boş geçmediğinden emin ol: beklenen route sayıları.
	if public != len(publicRoutes) {
		t.Errorf("public route sayısı = %d, beklenen %d (listedeki bir route artık yok mu?)", public, len(publicRoutes))
	}
	if protected < 11 {
		t.Errorf("korumalı route sayısı = %d, en az 11 bekleniyordu (Walk eksik dolaşmış olabilir)", protected)
	}
}

// Agent ucu oturum middleware'inin ARKASINDA olmamalı: kendi kimlik doğrulama
// mesajını vermeli ("oturum gerekli" değil).
func TestIngestMetrics_UsesAPIKeyNotSession(t *testing.T) {
	a := newFullAPI(t, time.Hour)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/metrics", strings.NewReader(`{"samples":[]}`))
	rec := httptest.NewRecorder()
	a.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized || !strings.Contains(rec.Body.String(), "Bearer") {
		t.Errorf("kod = %d, gövde = %q; API key (Bearer) istemeli", rec.Code, rec.Body.String())
	}
}

// ---- WebSocket + oturum ----

func startServer(t *testing.T, a *API) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(a.Routes())
	t.Cleanup(srv.Close)
	return srv
}

func dialWS(t *testing.T, srv *httptest.Server, header http.Header) (*websocket.Conn, *http.Response, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws", &websocket.DialOptions{HTTPHeader: header})
}

func cookieHeader(token string) http.Header {
	return http.Header{"Cookie": {sessionCookieName + "=" + token}}
}

func issue(t *testing.T, a *API, id int64) string {
	t.Helper()
	tok, _, err := a.Tokens.Issue(auth.User{ID: id, Email: "user@example.test", DisplayName: "Kullanici"})
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

func doLogout(t *testing.T, srv *httptest.Server, token string) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/v1/auth/logout", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: token})
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("logout kodu = %d, beklenen 204", resp.StatusCode)
	}
}

// watchClose: bağlantıyı tek bir goroutine'de sürekli okur; bağlantı kapanınca
// kapanma kodunu kanala yazar. NEDEN Read'i zaman aşımıyla yoklamıyoruz:
// coder/websocket'te context'i süresi dolan bir Read bağlantıyı KAPATIR;
// "hâlâ açık mı" diye kısa zaman aşımlı Read atmak bağlantıyı bizim öldürmemize
// yol açar.
func watchClose(conn *websocket.Conn) <-chan websocket.StatusCode {
	ch := make(chan websocket.StatusCode, 1)
	go func() {
		for {
			if _, _, err := conn.Read(context.Background()); err != nil {
				ch <- websocket.CloseStatus(err)
				return
			}
		}
	}()
	return ch
}

func expectOpen(t *testing.T, closed <-chan websocket.StatusCode, d time.Duration) {
	t.Helper()
	select {
	case code := <-closed:
		t.Fatalf("bağlantı beklenmedik biçimde kapandı (kod %d)", code)
	case <-time.After(d):
	}
}

func expectClosed(t *testing.T, closed <-chan websocket.StatusCode, within time.Duration) websocket.StatusCode {
	t.Helper()
	select {
	case code := <-closed:
		return code
	case <-time.After(within):
		t.Fatalf("bağlantı %v içinde kapanmadı", within)
		return -1
	}
}

func TestWS_RejectsUnauthenticated(t *testing.T) {
	a := newFullAPI(t, time.Hour)
	srv := startServer(t, a)

	for name, header := range map[string]http.Header{
		"cookie yok":   nil,
		"bozuk cookie": cookieHeader("bozuk.token.degeri"),
	} {
		conn, resp, err := dialWS(t, srv, header)
		if err == nil {
			conn.CloseNow()
			t.Errorf("%s: WebSocket yükseltmesi kabul edilmemeliydi", name)
			continue
		}
		if resp == nil || resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s: yanıt = %v, beklenen 401", name, resp)
		}
	}

	// Revoke edilmiş oturumla da bağlanılamaz.
	tok := issue(t, a, 1)
	doLogout(t, srv, tok)
	if conn, resp, err := dialWS(t, srv, cookieHeader(tok)); err == nil {
		conn.CloseNow()
		t.Error("logout edilmiş oturumla bağlanılabildi")
	} else if resp == nil || resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("logout edilmiş oturum: yanıt = %v, beklenen 401", resp)
	}
}

func TestWS_OriginCheckStillEnforcedWithValidSession(t *testing.T) {
	a := newFullAPI(t, time.Hour)
	srv := startServer(t, a)
	header := cookieHeader(issue(t, a, 1))
	header.Set("Origin", "https://evil.example")

	conn, resp, err := dialWS(t, srv, header)
	if err == nil {
		conn.CloseNow()
		t.Fatal("geçerli oturumla bile başka origin'den bağlanılmamalı")
	}
	if resp == nil || resp.StatusCode != http.StatusForbidden {
		t.Errorf("yanıt = %v, beklenen 403", resp)
	}
}

// İstenen senaryo: girişli WS aç → logout → bağlantı kapanmalı.
func TestWS_ClosedByServerOnLogout(t *testing.T) {
	a := newFullAPI(t, time.Hour)
	srv := startServer(t, a)

	tokA, tokB := issue(t, a, 1), issue(t, a, 2)
	connA, _, err := dialWS(t, srv, cookieHeader(tokA))
	if err != nil {
		t.Fatal(err)
	}
	defer connA.CloseNow()
	connB, _, err := dialWS(t, srv, cookieHeader(tokB))
	if err != nil {
		t.Fatal(err)
	}
	defer connB.CloseNow()
	closedA, closedB := watchClose(connA), watchClose(connB)

	// Logout'tan önce ikisi de açık.
	expectOpen(t, closedA, 300*time.Millisecond)

	start := time.Now()
	doLogout(t, srv, tokA)

	if code := expectClosed(t, closedA, 3*time.Second); code != realtime.CloseSessionEnded {
		t.Errorf("logout sonrası A'nın kapanma kodu = %d, beklenen %d", code, realtime.CloseSessionEnded)
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Errorf("bağlantı logout'tan %v sonra kapandı; anında (<1s) kapanmalıydı", elapsed)
	}

	// Başka kullanıcının bağlantısı etkilenmez.
	expectOpen(t, closedB, 300*time.Millisecond)
}

func TestWS_ClosedByServerAtTokenExpiry(t *testing.T) {
	// JWT exp saniye hassasiyetinde kırpıldığı için TTL 2 sn: token en az ~1 sn geçerli kalır.
	short := newFullAPI(t, 2*time.Second)
	srv := startServer(t, short)
	shortTok := issue(t, short, 1)

	// Kontrol: uzun ömürlü oturum aynı sunucuda açık kalır.
	long := auth.NewTokenService(apiTestSecret, time.Hour)
	longTok, _, _ := long.Issue(auth.User{ID: 2, Email: "user@example.test", DisplayName: "Kullanici"})

	connShort, _, err := dialWS(t, srv, cookieHeader(shortTok))
	if err != nil {
		t.Fatal(err)
	}
	defer connShort.CloseNow()
	connLong, _, err := dialWS(t, srv, cookieHeader(longTok))
	if err != nil {
		t.Fatal(err)
	}
	defer connLong.CloseNow()
	closedShort, closedLong := watchClose(connShort), watchClose(connLong)

	start := time.Now()
	if code := expectClosed(t, closedShort, 5*time.Second); code != realtime.CloseSessionEnded {
		t.Fatalf("süresi dolan oturumun kapanma kodu = %d, beklenen %d", code, realtime.CloseSessionEnded)
	}
	if elapsed := time.Since(start); elapsed > 3*time.Second {
		t.Errorf("bağlantı token süresi dolduktan çok sonra kapandı: %v", elapsed)
	}
	expectOpen(t, closedLong, 300*time.Millisecond)
}
