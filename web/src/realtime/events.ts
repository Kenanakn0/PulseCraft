import type { NodeLatest } from '../api/types'

// /ws üzerinden gelen olaylar (sunucudaki realtime.MetricEvent / AlertEvent ile aynı alan adları).

export interface MetricEvent extends NodeLatest {
  type: 'metric'
  node_id: string
}

export interface AlertEvent {
  type: 'alert'
  /** "opened" | "acknowledged" | "resolved" */
  event: string
  alert_id: number
  rule_id: number
  rule_name: string
  node_id: string
  severity: string
  metric: string
  threshold: number
  trigger_value: number
  status: string
  triggered_at: string
  acknowledged_by?: string
}

export type RealtimeEvent = MetricEvent | AlertEvent

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Ham WebSocket metnini doğrulanmış bir olaya çevirir; bozuk/bilinmeyen mesajda `null` döner.
 * TypeScript tipleri çalışma zamanında silindiği için (bkz. apiFetch) ağdan gelen veriye
 * güvenmek yerine burada alanların varlığı ve türü gerçekten denetlenir.
 */
export function parseEvent(raw: unknown): RealtimeEvent | null {
  if (typeof raw !== 'string') return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(data)) return null

  if (data.type === 'metric') {
    if (
      typeof data.node_id !== 'string' ||
      typeof data.time !== 'string' ||
      !Number.isFinite(Date.parse(data.time)) ||
      !isNum(data.cpu_percent) ||
      !isNum(data.mem_percent) ||
      !isNum(data.disk_percent) ||
      !isNum(data.mem_used_bytes) ||
      !isNum(data.net_rx_bps) ||
      !isNum(data.net_tx_bps)
    ) {
      return null
    }
    return {
      type: 'metric',
      node_id: data.node_id,
      time: data.time,
      cpu_percent: data.cpu_percent,
      mem_percent: data.mem_percent,
      mem_used_bytes: data.mem_used_bytes,
      disk_percent: data.disk_percent,
      net_rx_bps: data.net_rx_bps,
      net_tx_bps: data.net_tx_bps,
      load1: isNum(data.load1) ? data.load1 : null,
    }
  }

  if (data.type === 'alert') {
    if (typeof data.event !== 'string' || !isNum(data.alert_id) || typeof data.node_id !== 'string') return null
    return data as unknown as AlertEvent
  }

  return null
}
