import { describe, expect, it } from 'vitest'
import { makeNode } from '../test/fixtures'
import { appendLive, eventToPoint, MAX_AHEAD_MS, mergeLivePoints } from '../metrics/live'
import type { ChartPoint } from '../metrics/series'
import type { MetricEvent } from '../realtime/events'
import { eventToLatest, LIVE_ONLINE_MS, mergeLive, type LiveEntry } from './live'

const latestAt = (time: string, cpu = 99) => ({ ...makeNode().latest!, time, cpu_percent: cpu })
const entry = (time: string, online = true, cpu = 99): LiveEntry => ({ latest: latestAt(time, cpu), online })

describe('mergeLive', () => {
  it('canlı bilgi yoksa listeyi aynen (kopya olarak) döndürür', () => {
    const nodes = [makeNode()]
    const out = mergeLive(nodes, {})
    expect(out).toEqual(nodes)
    expect(out).not.toBe(nodes)
  })

  it('canlı ölçüm REST\'ten YENİYSE: son değerler ve çevrimiçi durumu canlıdan gelir', () => {
    const node = makeNode({ id: 'a', online: false, last_seen_seconds_ago: 300, latest: latestAt('2030-01-01T00:00:00Z', 10) })
    const [out] = mergeLive([node], { a: entry('2030-01-01T00:00:05Z', true, 77) })

    expect(out).toMatchObject({ online: true, last_seen_seconds_ago: 0 })
    expect(out?.latest?.cpu_percent).toBe(77)
  })

  it('REST ölçümü canlıdan yeni ya da AYNIYSA sunucunun hesabı kazanır', () => {
    const node = makeNode({ id: 'a', online: false, last_seen_seconds_ago: 40, latest: latestAt('2030-01-01T00:00:10Z', 10) })
    for (const t of ['2030-01-01T00:00:10Z', '2030-01-01T00:00:05Z']) {
      const [out] = mergeLive([node], { a: entry(t, true, 77) })
      expect(out).toBe(node)
    }
  })

  it('hiç ölçümü olmayan sunucuya canlı ölçüm uygulanır', () => {
    const node = makeNode({ id: 'a', online: false, latest: null, last_seen_seconds_ago: null })
    const [out] = mergeLive([node], { a: entry('2030-01-01T00:00:00Z') })
    expect(out).toMatchObject({ online: true, last_seen_seconds_ago: 0 })
  })

  it('sessizlik zamanlayıcısı dolunca çevrimdışı olur ve "son görülme" en az eşik kadar olur', () => {
    const node = makeNode({ id: 'a', last_seen_seconds_ago: 2, latest: latestAt('2030-01-01T00:00:00Z') })
    const [out] = mergeLive([node], { a: entry('2030-01-01T00:00:05Z', false) })
    expect(out).toMatchObject({ online: false, last_seen_seconds_ago: LIVE_ONLINE_MS / 1000 })
  })

  it('listede olmayan sunucunun canlı bilgisi yok sayılır; girdileri DEĞİŞTİRMEZ', () => {
    const node = makeNode({ id: 'a', online: false })
    const snapshot = structuredClone(node)
    const out = mergeLive([node], { yok: entry('2030-01-01T00:00:00Z'), a: entry('2031-01-01T00:00:00Z') })
    expect(out).toHaveLength(1)
    expect(node).toEqual(snapshot)
  })

  it('olaydan NodeLatest üretir (load1 null korunur)', () => {
    const ev = {
      type: 'metric', node_id: 'a', time: 't', cpu_percent: 1, mem_percent: 2, mem_used_bytes: 3,
      disk_percent: 4, net_rx_bps: 5, net_tx_bps: 6, load1: null,
    } satisfies MetricEvent
    expect(eventToLatest(ev)).toEqual({
      time: 't', cpu_percent: 1, mem_percent: 2, mem_used_bytes: 3, disk_percent: 4, net_rx_bps: 5, net_tx_bps: 6, load1: null,
    })
  })
})

const pt = (t: number, cpu = 1): ChartPoint => ({ t, cpu, mem: 2, disk: 3, rx: 4, tx: 5 })

describe('canlı grafik noktaları', () => {
  it('appendLive: eski/aynı zamanlı noktayı yok sayar (idempotent), sırayla ekler', () => {
    let buf: readonly ChartPoint[] = []
    buf = appendLive(buf, pt(1000))
    buf = appendLive(buf, pt(2000))
    const same = appendLive(buf, pt(2000))
    const older = appendLive(buf, pt(1500))
    expect(same).toBe(buf)
    expect(older).toBe(buf)
    expect(buf.map((p) => p.t)).toEqual([1000, 2000])
  })

  it('mergeLivePoints: REST\'in son noktasından yeni olanları ekler, pencereyi kaydırır, eskileri atar', () => {
    const base = [pt(1000), pt(2000), pt(3000)]
    const out = mergeLivePoints(base, 0, 4000, [pt(3000), pt(4500), pt(5000)])

    expect(out.to).toBe(5000)
    expect(out.from).toBe(1000) // pencere genişliği (4000) sabit
    expect(out.points.map((p) => p.t)).toEqual([1000, 2000, 3000, 4500, 5000])

    const far = mergeLivePoints(base, 0, 4000, [pt(9000)])
    expect(far.from).toBe(5000)
    expect(far.points.map((p) => p.t)).toEqual([9000]) // 1000-3000 pencere dışında kaldı
  })

  it('mergeLivePoints: canlı nokta yoksa/hepsi zaten REST\'teyse pencere değişmez', () => {
    const base = [pt(1000), pt(2000)]
    expect(mergeLivePoints(base, 0, 3000, [])).toEqual({ points: base, from: 0, to: 3000 })
    expect(mergeLivePoints(base, 0, 3000, [pt(1500), pt(2000)])).toEqual({ points: base, from: 0, to: 3000 })
  })

  it('mergeLivePoints: REST boşsa canlı noktalar grafiği başlatır', () => {
    const out = mergeLivePoints([], 0, 10_000, [pt(4000), pt(6000)])
    expect(out.points.map((p) => p.t)).toEqual([4000, 6000])
  })

  it('mergeLivePoints: pencerenin çok ilerisindeki (bozuk agent saati) nokta yok sayılır', () => {
    const base = [pt(1000)]
    const out = mergeLivePoints(base, 0, 2000, [pt(2000 + MAX_AHEAD_MS + 1)])
    expect(out).toEqual({ points: base, from: 0, to: 2000 })
  })

  it('mergeLivePoints girdileri DEĞİŞTİRMEZ', () => {
    const base = [pt(1000), pt(2000)]
    const live = [pt(3000)]
    const b = structuredClone(base)
    const l = structuredClone(live)
    mergeLivePoints(base, 0, 2500, live)
    expect(base).toEqual(b)
    expect(live).toEqual(l)
  })

  it('eventToPoint olayı grafik noktasına çevirir', () => {
    const ev: MetricEvent = {
      type: 'metric', node_id: 'a', time: '2030-01-01T00:00:00Z', cpu_percent: 1, mem_percent: 2,
      mem_used_bytes: 3, disk_percent: 4, net_rx_bps: 5, net_tx_bps: 6, load1: null,
    }
    expect(eventToPoint(ev)).toEqual({ t: Date.parse('2030-01-01T00:00:00Z'), cpu: 1, mem: 2, disk: 4, rx: 5, tx: 6 })
  })
})
