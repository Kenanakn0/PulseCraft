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

// ServeWS: GET /ws — bağlantıyı WebSocket'e yükseltir ve istemci kopana
// kadar hub'dan gelen mesajları ona yazar. İstemci başına bir goroutine
// (bu handler'ın kendisi) çalışır; net/http zaten her isteği ayrı goroutine'de
// çağırdığı için ayrıca `go` yazmaya gerek yok.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		// Geliştirme sırasında farklı porttaki frontend'in (Evre 4) bağlanabilmesi için.
		OriginPatterns: []string{"localhost:*", "127.0.0.1:*"},
	})
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

	for {
		select {
		case <-ctx.Done():
			conn.Close(websocket.StatusNormalClosure, "")
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
