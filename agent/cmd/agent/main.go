package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Kenanakn0/pulsecraft/agent/internal/collector"
)

func main() {
	info := collector.GetHostInfo()
	fmt.Println(info.String())

	// info bir değişken (addressable) olduğu için Go otomatik olarak &info alır
	// ve pointer receiver'lı SetNote orijinal info'yu değiştirir.
	info.SetNote("ilk ölçüm")
	fmt.Println(info.String())

	// Başarılı senaryo: gerçek disk yolu.
	diskPath := collector.DiskPath()
	if err := collector.CheckDiskPath(diskPath); err != nil {
		fmt.Println("HATA:", err)
	} else {
		fmt.Printf("Disk yolu bulundu: %s\n", diskPath)
	}

	// Hatalı senaryo: var olmayan bir yol -> error dönüşünü ve %w ile
	// sarmalanmış mesajı görmek için kasıtlı olarak yanlış bir yol veriyoruz.
	if err := collector.CheckDiskPath(`Z:\bu-yol-yok`); err != nil {
		fmt.Println("HATA (beklenen):", err)
	}

	runLoop()
}

// runLoop: time.Ticker ile periyodik olarak HostInfo basar. Ctrl+C (SIGINT)
// veya sonlandırma sinyali (SIGTERM) gelince context iptal edilir ve döngü
// düzgünce (graceful) kapanır. C#'taki CancellationToken + periyodik
// Task.Delay döngüsüne benzer bir yapı.
func runLoop() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// os/signal.Notify, işletim sisteminden gelen sinyalleri bir channel'a yazar.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)

	// Sinyal geldiğinde context'i iptal eden ayrı bir goroutine — C#'taki
	// arka planda sinyal bekleyen bir Task gibi düşünülebilir.
	go func() {
		<-sigCh
		fmt.Println("\nKapanış sinyali alındı...")
		cancel()
	}()

	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()

	fmt.Println("Metrik döngüsü başladı (durdurmak için Ctrl+C)...")

	for {
		// select, hangi channel önce hazır olursa onu işler.
		select {
		case <-ctx.Done():
			fmt.Println("Döngü durduruluyor, graceful shutdown tamam.")
			return
		case <-ticker.C:
			fmt.Println(collector.GetHostInfo().String())
		}
	}
}
