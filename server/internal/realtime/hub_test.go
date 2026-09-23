package realtime

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// newWSServer: ServeWS'i verilen oturumla sunan bir test sunucusu döndürür.
// Hub'ın Redis'e ihtiyacı yoktur (Run çağrılmıyor); mesajlar broadcast ile verilir.
func newWSServer(t *testing.T, sess Session) (*httptest.Server, *Hub) {
	t.Helper()
	hub := NewHub(nil)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hub.ServeWS(w, r, sess)
	}))
	t.Cleanup(srv.Close)
	return srv, hub
}

func wsURL(srv *httptest.Server) string { return "ws" + strings.TrimPrefix(srv.URL, "http") }

func dial(t *testing.T, srv *httptest.Server, header http.Header) (*websocket.Conn, *http.Response, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return websocket.Dial(ctx, wsURL(srv), &websocket.DialOptions{HTTPHeader: header})
}

// waitForClients: hub'a n istemci kaydolana dek bekler (add, Accept'ten sonra çalışır).
func waitForClients(t *testing.T, hub *Hub, n int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if hub.count() == n {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("hub istemci sayısı %d olmalıydı, şu an %d", n, hub.count())
}

// watchClose: bağlantıyı tek bir goroutine'de sürekli okur; bağlantı kapanınca
// kapanma kodunu kanala yazar (kapanma dışındaki hatalarda -1).
//
// NEDEN Read'i zaman aşımıyla yoklamıyoruz: coder/websocket'te context'i
// süresi dolan bir Read bağlantıyı KAPATIR. "Hâlâ açık mı?" diye kısa
// zaman aşımlı Read atmak, sunucu kapatmadan önce bağlantıyı bizim
// öldürmemize yol açar. Bu yardımcı bunun yerine kapanmayı bekler.
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

func TestServeWS_Broadcast(t *testing.T) {
	srv, hub := newWSServer(t, Session{})
	conn, _, err := dial(t, srv, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	waitForClients(t, hub, 1)

	hub.broadcast([]byte(`{"type":"metric"}`))

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, msg, err := conn.Read(ctx)
	if err != nil || string(msg) != `{"type":"metric"}` {
		t.Errorf("mesaj = %q, hata = %v", msg, err)
	}
}

func TestServeWS_OriginCheckStaysEnabled(t *testing.T) {
	srv, _ := newWSServer(t, Session{})

	// Başka bir site (ya da aynı makinedeki başka bir port) adına gelen istek reddedilmeli.
	for _, origin := range []string{"https://evil.example", "http://localhost:9999", "http://127.0.0.1:9999"} {
		conn, resp, err := dial(t, srv, http.Header{"Origin": {origin}})
		if err == nil {
			conn.CloseNow()
			t.Errorf("Origin %q kabul edilmemeliydi", origin)
			continue
		}
		if resp == nil || resp.StatusCode != http.StatusForbidden {
			t.Errorf("Origin %q: yanıt = %v, beklenen 403", origin, resp)
		}
	}

	// Aynı-origin (Origin host'u, isteğin Host'uyla aynı) kabul edilmeli.
	conn, _, err := dial(t, srv, http.Header{"Origin": {srv.URL}})
	if err != nil {
		t.Fatalf("aynı-origin reddedildi: %v", err)
	}
	conn.CloseNow()
}

func TestServeWS_ClosedWhenSessionRevoked(t *testing.T) {
	revoked := make(chan struct{})
	srv, hub := newWSServer(t, Session{ExpiresAt: time.Now().Add(time.Hour), Revoked: revoked})

	conn, _, err := dial(t, srv, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	waitForClients(t, hub, 1)
	closed := watchClose(conn)

	// İptal edilmeden bağlantı açık kalmalı.
	expectOpen(t, closed, 300*time.Millisecond)

	close(revoked)
	if code := expectClosed(t, closed, 2*time.Second); code != CloseSessionEnded {
		t.Errorf("kapanma kodu = %v, beklenen %d", code, CloseSessionEnded)
	}
	waitForClients(t, hub, 0)
}

func TestServeWS_ClosedAtExpiry(t *testing.T) {
	srv, hub := newWSServer(t, Session{ExpiresAt: time.Now().Add(400 * time.Millisecond)})

	conn, _, err := dial(t, srv, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	waitForClients(t, hub, 1)

	start := time.Now()
	if code := expectClosed(t, watchClose(conn), 3*time.Second); code != CloseSessionEnded {
		t.Fatalf("kapanma kodu = %v, beklenen %d", code, CloseSessionEnded)
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Errorf("bağlantı süre dolduktan çok sonra kapandı: %v", elapsed)
	}
	waitForClients(t, hub, 0)
}

func TestServeWS_AlreadyExpiredOrRevokedClosesImmediately(t *testing.T) {
	revoked := make(chan struct{})
	close(revoked)
	srv, _ := newWSServer(t, Session{Revoked: revoked})

	conn, _, err := dial(t, srv, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	if code := expectClosed(t, watchClose(conn), 2*time.Second); code != CloseSessionEnded {
		t.Errorf("kapanma kodu = %v, beklenen %d", code, CloseSessionEnded)
	}
}

func TestBroadcast_DropsSlowClientWithoutAffectingOthers(t *testing.T) {
	hub := NewHub(nil)
	slow := &client{send: make(chan []byte, 2)}
	fast := &client{send: make(chan []byte, 100)}
	hub.add(slow)
	hub.add(fast)

	for i := 0; i < 5; i++ {
		hub.broadcast([]byte("m"))
	}

	if _, alive := hub.clients[slow]; alive {
		t.Error("kuyruğu taşan yavaş istemci düşürülmeliydi")
	}
	if _, alive := hub.clients[fast]; !alive || len(fast.send) != 5 {
		t.Errorf("hızlı istemci tüm mesajları almalı: canlı=%v, kuyruk=%d", alive, len(fast.send))
	}
	// Düşürülen istemcinin channel'ı kapatıldı: okuyan taraf bunu fark eder.
	drained := 0
	for range slow.send {
		drained++
	}
	if drained != 2 {
		t.Errorf("yavaş istemcinin kuyruğunda %d mesaj vardı, beklenen 2", drained)
	}
}
