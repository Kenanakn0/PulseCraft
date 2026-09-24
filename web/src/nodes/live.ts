import type { NodeLatest, NodeSummary } from '../api/types'
import type { MetricEvent } from '../realtime/events'

/**
 * Bir sunucudan canlı akışta ölçüm gelmeyince, bu kadar ms sonra (ZAMANLAYICIYLA, duvar saati farkıyla
 * DEĞİL) sunucu çevrimdışı işaretlenir. Sunucudaki `onlineThreshold` (15 sn) ile aynıdır.
 */
export const LIVE_ONLINE_MS = 15_000

/** Canlı akıştan öğrenilen, henüz REST listesine yansımamış olabilecek durum. */
export interface LiveEntry {
  latest: NodeLatest
  online: boolean
}
export type LiveMap = Readonly<Record<string, LiveEntry>>

export function eventToLatest(ev: MetricEvent): NodeLatest {
  return {
    time: ev.time,
    cpu_percent: ev.cpu_percent,
    mem_percent: ev.mem_percent,
    mem_used_bytes: ev.mem_used_bytes,
    disk_percent: ev.disk_percent,
    net_rx_bps: ev.net_rx_bps,
    net_tx_bps: ev.net_tx_bps,
    load1: ev.load1,
  }
}

/**
 * REST listesini canlı olaylarla birleştirir. KURAL: hangisinin ölçümü DAHA YENİYSE (ölçüm zamanına
 * göre; iki taraf da sunucu/agent zamanı, tarayıcı saati değil) o kazanır. REST cevabı canlı olaydan
 * yeni ya da aynıysa sunucunun hesabı (online dahil) aynen kullanılır. Girdileri DEĞİŞTİRMEZ.
 */
export function mergeLive(nodes: readonly NodeSummary[], live: LiveMap): NodeSummary[] {
  if (Object.keys(live).length === 0) return [...nodes]

  return nodes.map((node) => {
    const entry = live[node.id]
    if (entry === undefined) return node

    const polledTime = node.latest === null ? Number.NEGATIVE_INFINITY : Date.parse(node.latest.time)
    if (polledTime >= Date.parse(entry.latest.time)) return node

    return {
      ...node,
      latest: entry.latest,
      online: entry.online,
      last_seen_seconds_ago: entry.online ? 0 : Math.max(node.last_seen_seconds_ago ?? 0, LIVE_ONLINE_MS / 1000),
    }
  })
}
