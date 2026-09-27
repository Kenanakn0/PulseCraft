package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/Kenanakn0/pulsecraft/server/internal/alerting"
	"github.com/Kenanakn0/pulsecraft/server/internal/api"
	"github.com/Kenanakn0/pulsecraft/server/internal/auth"
	"github.com/Kenanakn0/pulsecraft/server/internal/clientip"
	"github.com/Kenanakn0/pulsecraft/server/internal/config"
	"github.com/Kenanakn0/pulsecraft/server/internal/realtime"
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, nil)))

	cfg, err := config.Load()
	if err != nil {
		slog.Error("geçersiz konfigürasyon", "err", err)
		os.Exit(1)
	}
	demoUsers, err := auth.ParseDemoUsers(cfg.DemoUsers)
	if err != nil {
		slog.Error("geçersiz konfigürasyon", "err", err)
		os.Exit(1)
	}
	trustedProxies, err := clientip.ParseTrustedProxies(cfg.TrustedProxies)
	if err != nil {
		slog.Error("geçersiz konfigürasyon", "err", err)
		os.Exit(1)
	}
	slog.Info("konfigürasyon yüklendi", "addr", cfg.ListenAddr, "demo_users", len(demoUsers),
		"trusted_proxies", len(trustedProxies), "cookie_secure", cfg.CookieSecure)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("db pool oluşturulamadı", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		slog.Error("db'ye bağlanılamadı", "err", err)
		os.Exit(1)
	}
	slog.Info("db bağlantısı doğrulandı")

	if err := auth.SeedUsers(ctx, pool, demoUsers); err != nil {
		slog.Error("demo kullanıcılar kaydedilemedi", "err", err)
		os.Exit(1)
	}
	if len(demoUsers) == 0 {
		slog.Warn("DEMO_USERS boş: yeni kullanıcı eklenmedi (giriş yapabilecek kullanıcı DB'de yoksa kimse giriş yapamaz)")
	} else {
		slog.Info("demo kullanıcılar hazır", "count", len(demoUsers))
	}

	redisOpt, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		slog.Error("geçersiz REDIS_URL", "err", err)
		os.Exit(1)
	}
	rdb := redis.NewClient(redisOpt)
	defer rdb.Close()

	// Redis being unreachable does not stop the server: ingest and alerting keep working, only the live
	// stream pauses (go-redis reconnects by itself).
	if err := rdb.Ping(ctx).Err(); err != nil {
		slog.Warn("redis'e ulaşılamadı, canlı yayın çalışmayabilir", "err", err)
	} else {
		slog.Info("redis bağlantısı doğrulandı")
	}

	pub := realtime.NewPublisher(rdb)
	go pub.Run(ctx)
	hub := realtime.NewHub(rdb)
	go hub.Run(ctx)

	engine := alerting.New(pool, pub)
	if err := engine.Refresh(ctx); err != nil {
		slog.Error("alarm kuralları yüklenemedi", "err", err)
		os.Exit(1)
	}
	go engine.Run(ctx, 30*time.Second)

	denylist := auth.NewDenylist()
	go denylist.Run(ctx, 10*time.Minute)
	loginLimiter := auth.NewRateLimiter(10, time.Minute)
	go loginLimiter.Run(ctx, time.Minute)

	a := &api.API{
		DB: pool, Engine: engine, Pub: pub, Hub: hub,
		Tokens:       auth.NewTokenService(cfg.JWTSecret, auth.TokenTTL),
		Denylist:     denylist,
		LoginLimiter: loginLimiter,
		ClientIP:     clientip.New(trustedProxies),
		CookieSecure: cfg.CookieSecure,
	}
	srv := &http.Server{Addr: cfg.ListenAddr, Handler: a.Routes()}

	// Give in-flight requests 5 seconds to finish.
	go func() {
		<-ctx.Done()
		slog.Info("kapanış sinyali alındı, sunucu durduruluyor")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			slog.Error("sunucu düzgün kapatılamadı", "err", err)
		}
	}()

	slog.Info("sunucu dinliyor", "addr", cfg.ListenAddr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("sunucu durdu", "err", err)
		os.Exit(1)
	}
	slog.Info("sunucu durduruldu")
}
