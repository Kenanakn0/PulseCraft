import type { AlertRow, AlertSeverity, AlertStatus, NodeLatest } from '../api/types'

// /ws üzerinden gelen olaylar (sunucudaki realtime.MetricEvent / AlertEvent / RuleEvent / NodeEvent ile aynı alan adları).

export interface MetricEvent extends NodeLatest {
  type: 'metric'
  node_id: string
}

/**
 * Alarm olayı: alarmın TÜM satırını taşır (4.2a), böylece istemci bilmediği bir alarm için REST'e
 * gitmeden satır kurabilir. `event` yaşam döngüsündeki adımı söyler, `status` alarmın son durumudur.
 */
export interface AlertEvent extends AlertRow {
  type: 'alert'
  /** "opened" | "acknowledged" | "resolved" */
  event: string
  alert_id: number
}

/** Bir alarm kuralı silindi: ona bağlı TÜM alarmlar (geçmiş dahil) sunucuda da silindi. */
export interface RuleEvent {
  type: 'rule'
  event: 'deleted'
  rule_id: number
}

/** Bir sunucu silindi: ona ait TÜM alarm satırları (geçmiş dahil) sunucuda da silindi. */
export interface NodeEvent {
  type: 'node'
  event: 'deleted'
  node_id: string
}

export type RealtimeEvent = MetricEvent | AlertEvent | RuleEvent | NodeEvent

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isTime = (v: unknown): v is string => isStr(v) && Number.isFinite(Date.parse(v))
const isNullableTime = (v: unknown): v is string | null | undefined => v === null || v === undefined || isTime(v)

const STATUSES: readonly string[] = ['open', 'acknowledged', 'resolved'] satisfies AlertStatus[]
const SEVERITIES: readonly string[] = ['info', 'warning', 'critical'] satisfies AlertSeverity[]

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
      !isStr(data.node_id) ||
      !isTime(data.time) ||
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
    if (
      !isStr(data.event) ||
      !isNum(data.alert_id) ||
      !isNum(data.rule_id) ||
      !isStr(data.rule_name) ||
      !isStr(data.node_id) ||
      !isStr(data.node_name) ||
      !isStr(data.severity) ||
      !SEVERITIES.includes(data.severity) ||
      !isStr(data.metric) ||
      !isStr(data.operator) ||
      !isNum(data.threshold) ||
      !isNum(data.trigger_value) ||
      !isStr(data.status) ||
      !STATUSES.includes(data.status) ||
      !isTime(data.triggered_at) ||
      !isNullableTime(data.acknowledged_at) ||
      !isNullableTime(data.resolved_at) ||
      (data.acknowledged_by !== undefined && !isStr(data.acknowledged_by))
    ) {
      return null
    }
    return {
      type: 'alert',
      event: data.event,
      alert_id: data.alert_id,
      id: data.alert_id,
      rule_id: data.rule_id,
      rule_name: data.rule_name,
      node_id: data.node_id,
      node_name: data.node_name,
      severity: data.severity as AlertSeverity,
      metric: data.metric,
      operator: data.operator,
      threshold: data.threshold,
      trigger_value: data.trigger_value,
      status: data.status as AlertStatus,
      triggered_at: data.triggered_at,
      acknowledged_at: data.acknowledged_at ?? null,
      acknowledged_by: data.acknowledged_by ?? null,
      resolved_at: data.resolved_at ?? null,
    }
  }

  if (data.type === 'rule' && data.event === 'deleted' && isNum(data.rule_id)) {
    return { type: 'rule', event: 'deleted', rule_id: data.rule_id }
  }

  if (data.type === 'node' && data.event === 'deleted' && isStr(data.node_id) && data.node_id !== '') {
    return { type: 'node', event: 'deleted', node_id: data.node_id }
  }

  return null
}
