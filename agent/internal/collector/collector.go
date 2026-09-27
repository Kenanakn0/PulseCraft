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

type HostInfo struct {
	OS   string
	Arch string
	CPUs int
	Note string
}

func GetHostInfo() HostInfo {
	return HostInfo{
		OS:   runtime.GOOS,
		Arch: runtime.GOARCH,
		CPUs: numCPU(),
	}
}

func numCPU() int {
	return runtime.NumCPU()
}

func (h HostInfo) String() string {
	summary := fmt.Sprintf("OS: %s | Mimari: %s | CPU çekirdek: %d", h.OS, h.Arch, h.CPUs)
	if h.Note != "" {
		summary += fmt.Sprintf(" | Not: %s", h.Note)
	}
	return summary
}

func (h *HostInfo) SetNote(note string) {
	h.Note = note
}

func DiskPath() string {
	if runtime.GOOS == "windows" {
		return `C:\`
	}
	return "/"
}

func CheckDiskPath(path string) error {
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("disk yolu kontrol edilemedi (%s): %w", path, err)
	}
	return nil
}

// CPUPercent measures usage since the previous call (non-blocking), so it must be called at a
// regular interval. The very first call has no reference point and is unreliable.
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

func MemInfo() (percent float64, usedBytes uint64, err error) {
	v, err := mem.VirtualMemory()
	if err != nil {
		return 0, 0, fmt.Errorf("ram bilgisi okunamadı: %w", err)
	}
	return v.UsedPercent, v.Used, nil
}

func DiskPercent(path string) (float64, error) {
	usage, err := disk.Usage(path)
	if err != nil {
		return 0, fmt.Errorf("disk yüzdesi okunamadı (%s): %w", path, err)
	}
	return usage.UsedPercent, nil
}

// LoadAvg1 returns nil where the platform has no load average (Windows), instead of an error.
func LoadAvg1() *float64 {
	avg, err := load.Avg()
	if err != nil {
		return nil
	}
	return &avg.Load1
}

// NetRate turns the cumulative interface counters into bytes per second by remembering the previous
// reading. The zero value is ready to use.
type NetRate struct {
	lastRecv uint64
	lastSent uint64
	lastTime time.Time
}

// Sample returns 0, 0 on the first call, when there is no previous reading yet.
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

// Sample field names and JSON tags match the columns of the metrics table. There is no node_id: the
// server derives it from the API key.
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
