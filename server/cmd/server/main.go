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

	"github.com/Kenanakn0/pulsecraft/server/internal/alerting"
	"github.com/Kenanakn0/pulsecraft/server/internal/api"
	"github.com/Kenanakn0/pulsecraft/server/internal/config"
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, nil)))

	cfg := config.Load()
	slog.Info("konfigürasyon yüklendi", "addr", cfg.ListenAddr, "database_url_set", cfg.DatabaseURL != "")

	// Ctrl+C / SIGTERM gelince iptal edilen context — agent'taki
	// context.WithCancel + signal.Notify ikilisinin tek çağrılık kısayolu.
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

	engine := alerting.New(pool)
	if err := engine.Refresh(ctx); err != nil {
		slog.Error("alarm kuralları yüklenemedi", "err", err)
		os.Exit(1)
	}
	go engine.Run(ctx, 30*time.Second)

	a := &api.API{DB: pool, Engine: engine}
	srv := &http.Server{Addr: cfg.ListenAddr, Handler: a.Routes()}

	// Sinyal gelince (ctx iptal) sunucuyu, süren istekleri bitirmesi için
	// 5 saniye tanıyarak kapat.
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
