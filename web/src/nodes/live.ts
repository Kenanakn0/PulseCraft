import type { NodeLatest, NodeSummary } from '../api/types'
import type { MetricEvent } from '../realtime/events'

/**
 * Without a live sample for this long, a server is marked offline by a TIMER (not by comparing wall
 * clocks). Same as the server's onlineThreshold (15 s).
 */
export const LIVE_ONLINE_MS = 15_000

/** State learned from the live stream that the REST list may not reflect yet. */
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
 * Merges the REST list with live events. Rule: the side with the NEWER sample wins (by sample time, from
 * the server/agent, never the browser clock). If REST is newer or equal, the server's view (including
 * `online`) is used as is. Does not mutate its inputs.
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
