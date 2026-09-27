// Package clientip determines the real client IP of a request.
//
// Anyone can send X-Forwarded-For; trusting it blindly would let a single header bypass IP-based
// protections such as the login rate limit. It is therefore read only when the direct peer (RemoteAddr)
// is a trusted proxy. chi's middleware.RealIP does not check that and is deliberately not used.
package clientip

import (
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strings"
)

type Resolver struct {
	trusted []netip.Prefix
}

// New returns a Resolver; an empty list trusts no proxy (X-Forwarded-For is never read).
func New(trusted []netip.Prefix) *Resolver {
	return &Resolver{trusted: trusted}
}

// ParseTrustedProxies parses a comma-separated CIDR list; a single IP counts as /32 or /128. Invalid
// entries are an error, so the server refuses to start.
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

// ClientIP returns RemoteAddr unless the direct peer is trusted. Behind a trusted proxy the
// X-Forwarded-For chain is read right to left: trusted proxies are skipped and the first untrusted address
// is the client. Anything to its left can be forged by the client and is never looked at. If an
// unparsable entry is met, the last valid (trusted) hop is returned.
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
