// Package clientip, bir HTTP isteğinin gerçek istemci IP'sini güvenli biçimde bulur.
//
// X-Forwarded-For başlığını HERKES gönderebilir; körü körüne okumak, rate limit
// gibi IP'ye dayalı korumaları tek başlıkla atlatılabilir hale getirir. Bu yüzden
// başlık YALNIZCA bağlantıyı kuran doğrudan eş (RemoteAddr) güvenilir bir
// proxy ise okunur. chi'nin middleware.RealIP'i bu kontrolü yapmadığı için
// bilerek kullanılmıyor.
package clientip

import (
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// Resolver: güvenilir proxy adres aralıklarını tutar.
type Resolver struct {
	trusted []netip.Prefix
}

// New: verilen güvenilir aralıklarla bir Resolver döndürür. Boş liste =
// hiçbir proxy'ye güvenme (X-Forwarded-For hiç okunmaz).
func New(trusted []netip.Prefix) *Resolver {
	return &Resolver{trusted: trusted}
}

// ParseTrustedProxies: virgülle ayrılmış CIDR listesini ("10.0.0.0/8, ::1/128")
// ayrıştırır. Tek bir IP de kabul edilir (/32 ya da /128 sayılır). Boş metin,
// boş liste demektir. Geçersiz kayıt hata döndürür (server başlamamalı).
func ParseTrustedProxies(csv string) ([]netip.Prefix, error) {
	var prefixes []netip.Prefix
	for _, raw := range strings.Split(csv, ",") {
		entry := strings.TrimSpace(raw)
		if entry == "" {
			continue
		}

		if strings.Contains(entry, "/") {
			p, err := netip.ParsePrefix(entry)
			if err != nil {
				return nil, fmt.Errorf("TRUSTED_PROXIES: %q geçerli bir CIDR değil: %w", entry, err)
			}
			prefixes = append(prefixes, p.Masked())
			continue
		}

		addr, err := netip.ParseAddr(entry)
		if err != nil {
			return nil, fmt.Errorf("TRUSTED_PROXIES: %q geçerli bir IP ya da CIDR değil: %w", entry, err)
		}
		addr = addr.Unmap()
		prefixes = append(prefixes, netip.PrefixFrom(addr, addr.BitLen()))
	}
	return prefixes, nil
}

// ClientIP: isteğin istemci IP'sini döndürür.
//
//   - Doğrudan eş güvenilir değilse: RemoteAddr (X-Forwarded-For YOK SAYILIR).
//   - Güvenilirse: X-Forwarded-For zinciri SAĞDAN SOLA taranır; güvenilir
//     proxy'ler atlanır, ilk güvenilmeyen adres istemcidir. Zincirin sol tarafı
//     istemci tarafından uydurulabildiği için ilk güvenilmeyen adresin
//     solundakilere asla bakılmaz.
//   - Zincirde ayrıştırılamayan bir değer görülürse, ona en yakın son geçerli
//     (güvenilir) hop döndürülür.
func (r *Resolver) ClientIP(req *http.Request) netip.Addr {
	peer := parsePeer(req.RemoteAddr)
	if !peer.IsValid() || !r.isTrusted(peer) {
		return peer
	}

	var hops []string
	for _, header := range req.Header.Values("X-Forwarded-For") {
		for _, part := range strings.Split(header, ",") {
			hops = append(hops, strings.TrimSpace(part))
		}
	}

	current := peer
	for i := len(hops) - 1; i >= 0; i-- {
		ip, err := netip.ParseAddr(hops[i])
		if err != nil {
			return current
		}
		ip = ip.Unmap().WithZone("")
		if !r.isTrusted(ip) {
			return ip
		}
		current = ip
	}
	return current
}

func (r *Resolver) isTrusted(addr netip.Addr) bool {
	for _, p := range r.trusted {
		if p.Contains(addr) {
			return true
		}
	}
	return false
}

// parsePeer: "1.2.3.4:5678" ya da "[::1]:5678" biçimindeki RemoteAddr'dan IP'yi alır.
func parsePeer(remoteAddr string) netip.Addr {
	if ap, err := netip.ParseAddrPort(remoteAddr); err == nil {
		return ap.Addr().Unmap().WithZone("")
	}
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	addr, err := netip.ParseAddr(host)
	if err != nil {
		return netip.Addr{}
	}
	return addr.Unmap().WithZone("")
}
