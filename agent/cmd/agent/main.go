package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Kenanakn0/pulsecraft/agent/internal/collector"
	"github.com/Kenanakn0/pulsecraft/agent/internal/config"
	"github.com/Kenanakn0/pulsecraft/agent/internal/sender"
)

func main() {

	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, nil)))

	cfg := config.Load()
	slog.Info("konfigürasyon yüklendi",
		"server", cfg.ServerURL,
		"interval", cfg.Interval,
		"api_key_kaynagi", cfg.APIKeySource, // never the key itself
		"hostname_gonderiliyor", cfg.Hostname != "")

	info := collector.GetHostInfo()
	slog.Info("host bilgisi", "os", info.OS, "arch", info.Arch, "cpus", info.CPUs)

	diskPath := collector.DiskPath()
	if err := collector.CheckDiskPath(diskPath); err != nil {
		slog.Error("disk yolu kontrolü başarısız", "err", err)
	} else {
		slog.Info("disk yolu bulundu", "path", diskPath)
	}

	os.Exit(runLoop(cfg))
}

// exitUnauthorized differs from the configuration error code (2) so supervisors can tell them apart.
const exitUnauthorized = 3

// unauthorizedHelp goes to stderr so it is not lost between the per-second metric log lines.
const unauthorizedHelp = `
HATA: Sunucu API anahtarını REDDETTİ (HTTP 401). Agent duruyor.
Olası nedenler:
  - Anahtar yanlış ya da eksik kopyalandı (arayüzdeki "Kopyala" ile yeniden deneyin).
  - Sunucu (node) arayüzden silindi; silinen sunucunun anahtarı artık geçersizdir.
  - -server başka bir PulseCraft sunucusunu gösteriyor.
Anahtarı kaybettiyseniz sunucuyu arayüzden silip yeniden ekleyin; yeni anahtar yalnızca bir kez gösterilir.`

func runLoop(cfg config.Config) int {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)

	go func() {
		<-sigCh
		slog.Info("kapanış sinyali alındı")
		cancel()
	}()

	// The first CPUPercent call has no reference point; make it once and discard the result.
	_, _ = collector.CPUPercent()

	// netRate must live for the whole loop: it keeps the previous counters to compute a rate.
	netRate := &collector.NetRate{}

	buffered := sender.NewBuffered(sender.New(cfg.ServerURL, cfg.APIKey, cfg.Hostname), 1000)

	ticker := time.NewTicker(cfg.Interval)
	defer ticker.Stop()

	slog.Info("metrik döngüsü başladı", "durdurmak_icin", "Ctrl+C")

	for {
		select {
		case <-ctx.Done():
			slog.Info("döngü durduruluyor, graceful shutdown tamam")
			return 0
		case <-ticker.C:
			if err := collectAndSend(ctx, netRate, buffered); errors.Is(err, sender.ErrUnauthorized) {
				slog.Error("sunucu API anahtarını reddetti, agent duruyor", "server", cfg.ServerURL)
				fmt.Fprintln(os.Stderr, unauthorizedHelp)
				return exitUnauthorized
			}
		}
	}
}

func collectAndSend(ctx context.Context, netRate *collector.NetRate, buffered *sender.BufferedSender) error {
	sample, err := collector.Collect(netRate)
	if err != nil {
		slog.Error("metrik toplama başarısız", "err", err)
		return nil
	}

	loadAttr := slog.String("load1", "yok (Windows)")
	if sample.Load1 != nil {
		loadAttr = slog.Float64("load1", *sample.Load1)
	}

	slog.Info("metrik",
		"cpu_percent", sample.CPUPercent,
		"mem_percent", sample.MemPercent,
		"mem_used_mb", sample.MemUsedBytes/1024/1024,
		"disk_percent", sample.DiskPercent,
		"net_rx_bps", sample.NetRxBps,
		"net_tx_bps", sample.NetTxBps,
		loadAttr)

	buffered.Add(sample)
	return buffered.Flush(ctx)
}
