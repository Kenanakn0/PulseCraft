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

// clientBuffer is each client's queue. A client whose queue is full is dropped so that one slow client
// cannot delay the broadcast for everybody.
const clientBuffer = 256

type client struct {
	send chan []byte
}

// Hub subscribes to Redis and fans messages out to its WebSocket clients. Going through Redis lets every
// server instance serve its own clients.
type Hub struct {
	rdb *redis.Client

	mu      sync.Mutex
	clients map[*client]struct{}
}

func NewHub(rdb *redis.Client) *Hub {
	return &Hub{rdb: rdb, clients: make(map[*client]struct{})}
}

// Run relays Redis messages until ctx is cancelled; go-redis reconnects on its own.
func (h *Hub) Run(ctx context.Context) {
	ps := h.rdb.Subscribe(ctx, ChannelMetrics, ChannelAlerts)
	defer ps.Close()

	go func() {
		<-ctx.Done()
		ps.Close() // closes Channel(), which ends the loop below
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
			// Queue full: drop the slow client. ServeWS notices the closed channel and closes the connection.
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

// CloseSessionEnded (from the 4000-4999 application range) is used when the session expires or is
// revoked. The frontend then goes to the login page instead of reconnecting; 1008 (slow client dropped)
// calls for a reconnect.
const CloseSessionEnded websocket.StatusCode = 4401

// Session: the server closes the connection itself at ExpiresAt or when Revoked is closed (logout);
// otherwise an open WebSocket would keep receiving data after its session ended. The zero value means
// no limit.
type Session struct {
	ExpiresAt time.Time
	Revoked   <-chan struct{}
}

// ServeWS upgrades the connection and writes hub messages to it until the client leaves or the session
// ends.
//
// The Origin check stays on: coder/websocket requires the Origin host to equal the request's Host. A
// reverse proxy must therefore forward Host including the port (nginx: $http_host; $host drops the
// port and breaks the check for addresses like localhost:8080).
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request, sess Session) {
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return // Accept has written the error response
	}
	defer conn.CloseNow()

	c := &client{send: make(chan []byte, clientBuffer)}
	h.add(c)
	defer h.remove(c)

	// The server expects no messages; CloseRead discards them and cancels the context when the client closes.
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
		case <-sess.Revoked: // a nil channel blocks forever: never fires without a session
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
