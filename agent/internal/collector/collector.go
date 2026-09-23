package collector

import (
	"fmt"
	"os"
	"runtime"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/load"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/shirou/gopsutil/v4/net"
)

// HostInfo büyük harfle başladığı için dışarıdan kullanılabilir (public)
type HostInfo struct {
	OS   string
	Arch string
	CPUs int
	Note string // pointer receiver örneğini göstermek için: sonradan eklenen bir not
}

// GetHostInfo: public fonksiyon
func GetHostInfo() HostInfo {
	return HostInfo{
		OS:   runtime.GOOS,
		Arch: runtime.GOARCH,
		CPUs: numCPU(),
	}
}

// numCPU küçük harfle başladığı için sadece bu paket içinde kullanılabilir (private)
func numCPU() int {
	return runtime.NumCPU()
}

// String: value receiver metot. HostInfo'nun bir KOPYASI üzerinde çalışır,
// çağıran taraftaki orijinal değeri değiştiremez. C#'taki `override ToString()`
// gibi düşünülebilir — sadece okuyup bir sonuç üretir.
func (h HostInfo) String() string {
	summary := fmt.Sprintf("OS: %s | Mimari: %s | CPU çekirdek: %d", h.OS, h.Arch, h.CPUs)
	if h.Note != "" {
		summary += fmt.Sprintf(" | Not: %s", h.Note)
	}
	return summary
}

// SetNote: pointer receiver metot. *HostInfo üzerinde çalışır, çağrıldığı
// değişkenin ORİJİNALİNİ değiştirir. C#'ta bir metodun `ref` parametreyle
// alanı değiştirmesine benzer semantik.
func (h *HostInfo) SetNote(note string) {
	h.Note = note
}

// DiskPath: işletim sistemine göre izlenecek disk kökünü döndürür.
// Evre 2.2'de disk % hesaplamasında kullanılacak.
func DiskPath() string {
	if runtime.GOOS == "windows" {
		return `C:\`
	}
	return "/"
}

// CheckDiskPath: verilen yolun var olup olmadığını kontrol eder.
// Yol bulunamazsa altta yatan hatayı %w ile sarmalayıp bağlam ekler.
func CheckDiskPath(path string) error {
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("disk yolu kontrol edilemedi (%s): %w", path, err)
	}
	return nil
}

// CPUPercent: toplam CPU kullanım yüzdesini döndürür.
// interval=0 vermek, bir önceki CPUPercent çağrısından bu yana geçen süredeki
// kullanımı ölçer (bloklamadan) — bu yüzden düzenli aralıklarla (ör. ticker
// ile) tekrar tekrar çağrılmalıdır. İlk çağrı referans noktası olmadığı için
// güvenilir değildir; çağıran taraf bunu bilerek bir "ısınma" çağrısı yapmalı.
func CPUPercent() (float64, error) {
	percentages, err := cpu.Percent(0, false)
	if err != nil {
		return 0, fmt.Errorf("cpu yüzdesi okunamadı: %w", err)
	}
	if len(percentages) == 0 {
		return 0, fmt.Errorf("cpu yüzdesi okunamadı: boş sonuç döndü")
	}
	return percentages[0], nil
}

// MemInfo: RAM kullanım yüzdesini ve kullanılan bayt miktarını döndürür.
func MemInfo() (percent float64, usedBytes uint64, err error) {
	v, err := mem.VirtualMemory()
	if err != nil {
		return 0, 0, fmt.Errorf("ram bilgisi okunamadı: %w", err)
	}
	return v.UsedPercent, v.Used, nil
}

// DiskPercent: verilen yoldaki disk kullanım yüzdesini döndürür.
func DiskPercent(path string) (float64, error) {
	usage, err := disk.Usage(path)
	if err != nil {
		return 0, fmt.Errorf("disk yüzdesi okunamadı (%s): %w", path, err)
	}
	return usage.UsedPercent, nil
}

// LoadAvg1: 1 dakikalık sistem yük ortalamasını döndürür.
// Windows'ta bu kavram işletim sistemi tarafından desteklenmediği için
// gopsutil hata döner; biz bunu hata olarak değil "bu platformda anlamsız"
// olarak ele alıp nil döndürüyoruz. C#'taki `double?` (Nullable<double>)
// karşılığı gibi düşünülebilir: nil = değer yok.
func LoadAvg1() *float64 {
	avg, err := load.Avg()
	if err != nil {
		return nil
	}
	return &avg.Load1
}

// NetRate: network sayaçları toplamdan (boot'tan beri byte) verildiği için
// byte/saniye hızını hesaplamak amacıyla bir önceki ölçümü saklar. Sıfır
// değeri (NetRate{}) kullanıma hazırdır, ayrı bir kurucuya gerek yoktur.
type NetRate struct {
	lastRecv uint64
	lastSent uint64
	lastTime time.Time
}

// Sample: pointer receiver — çünkü bu metot her çağrıldığında r'nin
// içindeki son ölçüm bilgisini GÜNCELLEMESİ gerekiyor (Adım 1'deki SetNote
// örneğiyle aynı mantık). Mevcut sayaçları okur, bir önceki çağrıdan bu yana
// geçen süreye göre rx/tx byte/saniye hesaplar. İlk çağrıda referans nokta
// olmadığı için 0, 0 döner.
func (r *NetRate) Sample() (rxBps float64, txBps float64, err error) {
	counters, err := net.IOCounters(false)
	if err != nil {
		return 0, 0, fmt.Errorf("network sayaçları okunamadı: %w", err)
	}
	if len(counters) == 0 {
		return 0, 0, fmt.Errorf("network sayaçları okunamadı: boş sonuç döndü")
	}

	now := time.Now()
	recv := counters[0].BytesRecv
	sent := counters[0].BytesSent

	if r.lastTime.IsZero() {
		r.lastRecv, r.lastSent, r.lastTime = recv, sent, now
		return 0, 0, nil
	}

	elapsed := now.Sub(r.lastTime).Seconds()
	if elapsed > 0 {
		rxBps = float64(recv-r.lastRecv) / elapsed
		txBps = float64(sent-r.lastSent) / elapsed
	}

	r.lastRecv, r.lastSent, r.lastTime = recv, sent, now
	return rxBps, txBps, nil
}

// Sample: bir anlık metrik ölçümü. Alan adları ve JSON etiketleri,
// deploy/init/01_schema.sql'deki metrics tablosu sütunlarıyla birebir aynı
// tutulur — Evre 2.3'te bu struct doğrudan JSON'a çevrilip sunucuya
// gönderilecek. node_id burada yok: sunucu, isteğin Authorization
// başlığındaki API key'inden hangi node'a ait olduğunu bulacak.
type Sample struct {
	Time         time.Time `json:"time"`
	CPUPercent   float64   `json:"cpu_percent"`
	MemPercent   float64   `json:"mem_percent"`
	MemUsedBytes uint64    `json:"mem_used_bytes"`
	DiskPercent  float64   `json:"disk_percent"`
	NetRxBps     int64     `json:"net_rx_bps"`
	NetTxBps     int64     `json:"net_tx_bps"`
	Load1        *float64  `json:"load1,omitempty"`
}

// Collect: CPU/RAM/Disk/Network/Load1'i tek seferde okuyup bir Sample
// içinde toplar. netRate, çağrılar arasında network hızı hesaplamak için
// gereken durumu taşır (bkz. NetRate.Sample).
func Collect(netRate *NetRate) (Sample, error) {
	cpuPercent, err := CPUPercent()
	if err != nil {
		return Sample{}, err
	}

	memPercent, memUsed, err := MemInfo()
	if err != nil {
		return Sample{}, err
	}

	diskPercent, err := DiskPercent(DiskPath())
	if err != nil {
		return Sample{}, err
	}

	rxBps, txBps, err := netRate.Sample()
	if err != nil {
		return Sample{}, err
	}

	return Sample{
		Time:         time.Now(),
		CPUPercent:   cpuPercent,
		MemPercent:   memPercent,
		MemUsedBytes: memUsed,
		DiskPercent:  diskPercent,
		NetRxBps:     int64(rxBps),
		NetTxBps:     int64(txBps),
		Load1:        LoadAvg1(),
	}, nil
}
