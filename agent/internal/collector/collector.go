package collector

import (
	"fmt"
	"os"
	"runtime"
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
