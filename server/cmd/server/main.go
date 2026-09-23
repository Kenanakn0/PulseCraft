package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Kenanakn0/pulsecraft/server/internal/api"
	"github.com/Kenanakn0/pulsecraft/server/internal/config"
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, nil)))

	cfg := config.Load()
	slog.Info("konfigürasyon yüklendi", "addr", cfg.ListenAddr, "database_url_set", cfg.DatabaseURL != "")

	ctx := context.Background()

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

	a := &api.API{DB: pool}

	slog.Info("sunucu dinliyor", "addr", cfg.ListenAddr)
	if err := http.ListenAndServe(cfg.ListenAddr, a.Routes()); err != nil {
		slog.Error("sunucu durdu", "err", err)
		os.Exit(1)
	}
}
