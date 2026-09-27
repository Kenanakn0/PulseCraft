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
		"api_key_kaynagi", cfg.APIKeySource, // anahtarın KENDİSİ asla loglanmaz
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

// exitUnauthorized: sunucu anahtarı reddedince agent'ın çıkış kodu (2 = yapılandırma hatası ile karışmasın).
const exitUnauthorized = 3

// unauthorizedHelp: 401'de gösterilen açıklama. stderr'e yazılır ki saniyede bir akan ölçüm log
// satırlarının arasında kaybolmasın.
const unauthorizedHelp = `
HATA: Sunucu API anahtarını REDDETTİ (HTTP 401). Agent duruyor.
Olası nedenler:
  - Anahtar yanlış ya da eksik kopyalandı (arayüzdeki "Kopyala" ile yeniden deneyin).
  - Sunucu (node) arayüzden silindi; silinen sunucunun anahtarı artık geçersizdir.
  - -server başka bir PulseCraft sunucusunu gösteriyor.
Anahtarı kaybettiyseniz sunucuyu arayüzden silip yeniden ekleyin; yeni anahtar yalnızca bir kez gösterilir.`

// runLoop: time.Ticker ile periyodik olarak HostInfo basar. Ctrl+C (SIGINT)
// veya sonlandırma sinyali (SIGTERM) gelince context iptal edilir ve döngü
// düzgünce (graceful) kapanır. C#'taki CancellationToken + periyodik
// Task.Delay döngüsüne benzer bir yapı.
func runLoop(cfg config.Config) int {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// os/signal.Notify, işletim sisteminden gelen sinyalleri bir channel'a yazar.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)

	// Sinyal geldiğinde context'i iptal eden ayrı bir goroutine — C#'taki
	// arka planda sinyal bekleyen bir Task gibi düşünülebilir.
	go func() {
		<-sigCh
		slog.Info("kapanış sinyali alındı")
		cancel()
	}()

	// İlk CPUPercent çağrısının referans noktası yoktur (güvenilmez), bu yüzden
	// döngü başlamadan bir kez "ısınma" çağrısı yapıp sonucu atıyoruz.
	_, _ = collector.CPUPercent()

	// netRate, döngü boyunca yaşayan TEK bir NetRate örneği — pointer receiver'lı
	// Sample() metodu her tick'te bu örneğin içindeki son ölçümü günceller.
	netRate := &collector.NetRate{}

	// buffered, gönderilemeyen örnekleri saklayıp exponential backoff ile
	// tekrar deneyen sarmalayıcı. En fazla 1000 örnek tutar.
	buffered := sender.NewBuffered(sender.New(cfg.ServerURL, cfg.APIKey, cfg.Hostname), 1000)

	ticker := time.NewTicker(cfg.Interval)
	defer ticker.Stop()

	slog.Info("metrik döngüsü başladı", "durdurmak_icin", "Ctrl+C")

	for {
		// select, hangi channel önce hazır olursa onu işler.
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

// collectAndSend: bir Sample toplar, loglar, buffer'a ekler ve buffer'ı
// göndermeyi dener (backoff izin veriyorsa). Sunucu henüz yokken (Evre 3
// tamamlanana kadar) örnekler buffer'da birikir, backoff süresi katlanarak
// artar — bu BEKLENEN bir davranıştır.
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
