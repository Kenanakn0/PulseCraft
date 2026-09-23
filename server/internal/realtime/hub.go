package realtime

import (
	"context"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/redis/go-redis/v9"
)

// clientBuffer: bir istemcinin bekleyen mesaj kuyruğu. Kuyruk dolarsa istemci
// "yavaş" sayılıp düşürülür — bir yavaş istemci tüm yayını geciktirmesin diye.
const clientBuffer = 256

type client struct {
	send chan []byte
}

// Hub: Redis'e SUBSCRIBE olur, gelen her mesajı bağlı tüm WebSocket
// istemcilerine dağıtır. Server birden çok kopya çalışsa bile her biri kendi
// istemcilerine yayın yapabilsin diye aracı olarak Redis Pub/Sub kullanılır.
type Hub struct {
	rdb *redis.Client

	mu      sync.Mutex
	clients map[*client]struct{}
}

func NewHub(rdb *redis.Client) *Hub {
	return &Hub{rdb: rdb, clients: make(map[*client]struct{})}
}

// Run: ctx iptal edilene kadar Redis kanallarını dinleyip yayınlar.
// go-redis kopan bağlantıyı kendisi yeniden kurar.
func (h *Hub) Run(ctx context.Context) {
	ps := h.rdb.Subscribe(ctx, ChannelMetrics, ChannelAlerts)
	defer ps.Close()

	go func() {
		<-ctx.Done()
		ps.Close() // Channel() kapanır, aşağıdaki döngü biter
	}()

	for msg := range ps.Channel() {
		h.broadcast([]byte(msg.Payload))
	}
}

func (h *Hub) broadcast(payload []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()

	for c := range h.clients {
		select {
		case c.send <- payload:
		default:
			// Kuyruk dolu: yavaş istemciyi düşür. send kapanınca ServeWS
			// döngüsü bunu fark edip bağlantıyı kapatır.
			delete(h.clients, c)
			close(c.send)
			slog.Warn("yavaş websocket istemcisi düşürüldü")
		}
	}
}

func (h *Hub) add(c *client) {
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
	slog.Info("websocket istemcisi bağlandı", "clients", h.count())
}

func (h *Hub) remove(c *client) {
	h.mu.Lock()
	if _, ok := h.clients[c]; ok {
		delete(h.clients, c)
		close(c.send)
	}
	h.mu.Unlock()
	slog.Info("websocket istemcisi ayrıldı", "clients", h.count())
}

func (h *Hub) count() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.clients)
}

// CloseSessionEnded: oturum süresi dolduğunda ya da logout ile iptal edildiğinde
// sunucunun kullandığı uygulamaya özel kapatma kodu (4000-4999 aralığı
// uygulamalara ayrılmıştır). Frontend bu kodu görünce yeniden bağlanmayı
// denemek yerine giriş ekranına yönlenmelidir; standart 1008 (yavaş istemci
// düşürüldü) ise yeniden bağlanmayı gerektirir.
const CloseSessionEnded websocket.StatusCode = 4401

// Session: bağlantının dayandığı oturum. Sunucu, bağlantıyı ExpiresAt anında ya
// da Revoked kapandığında (logout) kendisi kapatır; aksi halde açık bir
// WebSocket, oturumu bitse de sonsuza dek veri almaya devam ederdi.
// Sıfır değer (ExpiresAt sıfır, Revoked nil) "sınırsız" demektir.
type Session struct {
	ExpiresAt time.Time
	Revoked   <-chan struct{}
}

// ServeWS: GET /ws — bağlantıyı WebSocket'e yükseltir ve istemci kopana (ya da
// oturum bitene) kadar hub'dan gelen mesajları ona yazar. İstemci başına bir
// goroutine (bu handler'ın kendisi) çalışır; net/http zaten her isteği ayrı
// goroutine'de çağırdığı için ayrıca `go` yazmaya gerek yok.
//
// Origin kontrolü AÇIK: coder/websocket varsayılan olarak Origin başlığının
// host'unun isteğin Host başlığıyla aynı olmasını ister (aynı-origin). Reverse
// proxy Host başlığını PORT DAHİL korumalıdır (nginx: proxy_set_header Host
// $http_host; $host portu atar ve localhost:8080 gibi adreslerde kontrolü bozar).
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request, sess Session) {
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return // Accept, hata yanıtını kendisi yazdı
	}
	defer conn.CloseNow()

	c := &client{send: make(chan []byte, clientBuffer)}
	h.add(c)
	defer h.remove(c)

	// Bu sunucu istemciden mesaj beklemiyor; CloseRead, istemci kapatınca
	// iptal olan bir context döndürür ve gelen mesajları atar.
	ctx := conn.CloseRead(r.Context())

	var expiry <-chan time.Time
	if !sess.ExpiresAt.IsZero() {
		timer := time.NewTimer(time.Until(sess.ExpiresAt))
		defer timer.Stop()
		expiry = timer.C
	}

	for {
		select {
		case <-ctx.Done():
			conn.Close(websocket.StatusNormalClosure, "")
			return
		case <-sess.Revoked: // nil channel'dan okuma sonsuza dek bloklar: oturumsuz kullanımda hiç tetiklenmez
			conn.Close(CloseSessionEnded, "oturum sonlandırıldı")
			return
		case <-expiry:
			conn.Close(CloseSessionEnded, "oturum süresi doldu")
			return
		case msg, ok := <-c.send:
			if !ok {
				conn.Close(websocket.StatusPolicyViolation, "istemci çok yavaş")
				return
			}
			writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			err := conn.Write(writeCtx, websocket.MessageText, msg)
			cancel()
			if err != nil {
				return
			}
		}
	}
}
