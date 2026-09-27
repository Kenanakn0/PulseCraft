import type { AlertRow, AlertStatus } from '../api/types'
import type { AlertEvent } from '../realtime/events'

/**
 * Alarm durumları tek yönlü bir merdiven oluşturur: open → acknowledged → resolved. Olaylar geç,
 * tekrarlı ya da sırasız gelebildiği için (bkz. docs/decisions.md "Real-time delivery") bir alarm
 * ASLA daha düşük bir basamağa geri alınmaz: yalnızca aynı ya da daha yüksek basamaktaki bilgi uygulanır.
 */
export const STATUS_RANK: Record<AlertStatus, number> = { open: 0, acknowledged: 1, resolved: 2 }

/** Olay akışından öğrenilen bir satır ve onu öğrendiğimiz sıra numarası. */
export interface OverlayEntry {
  row: AlertRow
  seq: number
}

/**
 * Olay durumu. `seq`, uygulanan her (etkili) olayda artan sayaçtır; REST anlık görüntüsünün HANGİ
 * olaylardan sonra alındığını karşılaştırmak için kullanılır (mergeAlerts).
 */
export interface EventState {
  seq: number
  rows: Readonly<Record<number, OverlayEntry>>
  /** Silinen kuralların id'leri: alarmları sunucuda da silindi, hiçbir kaynaktan gösterilmez. */
  deletedRules: readonly number[]
  /** Silinen sunucuların id'leri: aynı gerekçeyle (sunucu silinince alarmları cascade ile gider). */
  deletedNodes: readonly string[]
}

export const initialEventState: EventState = { seq: 0, rows: {}, deletedRules: [], deletedNodes: [] }

export type EventAction =
  | { type: 'alert'; event: AlertEvent }
  | { type: 'ruleDeleted'; ruleId: number }
  | { type: 'nodeDeleted'; nodeId: string }

/** Olaydan alarm satırı kurar (olay alarmın tüm alanlarını taşır). */
export function toRow(event: AlertEvent): AlertRow {
  return {
    id: event.alert_id,
    rule_id: event.rule_id,
    rule_name: event.rule_name,
    severity: event.severity,
    metric: event.metric,
    operator: event.operator,
    threshold: event.threshold,
    node_id: event.node_id,
    node_name: event.node_name,
    status: event.status,
    trigger_value: event.trigger_value,
    triggered_at: event.triggered_at,
    acknowledged_at: event.acknowledged_at,
    acknowledged_by: event.acknowledged_by,
    resolved_at: event.resolved_at,
  }
}

/**
 * Saf (pure) reducer: `(durum, olay) → yeni durum`. React'te `useReducer`, C#'ta değişmez bir durum
 * nesnesi üzerinde `Apply(event)` metodu gibi. Girdiyi DEĞİŞTİRMEZ; etkisiz olayda AYNI nesneyi döndürür
 * (React gereksiz yeniden çizim yapmaz).
 */
export function eventReducer(state: EventState, action: EventAction): EventState {
  if (action.type === 'ruleDeleted') {
    if (state.deletedRules.includes(action.ruleId)) return state
    const rows = Object.fromEntries(
      Object.entries(state.rows).filter(([, entry]) => entry.row.rule_id !== action.ruleId),
    )
    return { ...state, seq: state.seq + 1, rows, deletedRules: [...state.deletedRules, action.ruleId] }
  }

  if (action.type === 'nodeDeleted') {
    if (state.deletedNodes.includes(action.nodeId)) return state
    const rows = Object.fromEntries(
      Object.entries(state.rows).filter(([, entry]) => entry.row.node_id !== action.nodeId),
    )
    return { ...state, seq: state.seq + 1, rows, deletedNodes: [...state.deletedNodes, action.nodeId] }
  }

  const row = toRow(action.event)
  if (state.deletedRules.includes(row.rule_id) || state.deletedNodes.includes(row.node_id)) return state

  const existing = state.rows[row.id]?.row
  if (existing !== undefined && STATUS_RANK[row.status] < STATUS_RANK[existing.status]) return state // eski/geç olay

  const seq = state.seq + 1
  return { ...state, seq, rows: { ...state.rows, [row.id]: { row, seq } } }
}

/**
 * REST anlık görüntüsünü (`snapshot`) olay durumuyla birleştirir.
 *
 * `startSeq`: anlık görüntünün İSTEĞİ başlarken olay sayacının değeri. Bundan ÖNCE alınan olaylar
 * anlık görüntüde zaten yansıdığı için atlanır (aksi halde sunucuda silinmiş/değişmiş bir satırın eski
 * olay kopyası hayalet gibi kalırdı). İSTEK SIRASINDA ya da SONRA gelen olaylar anlık görüntüde
 * olmayabilir: uygulanır, ama yalnızca durumu anlık görüntüdekinden AZ olmayanlar (merdiven kuralı).
 */
export function mergeAlerts(snapshot: readonly AlertRow[], startSeq: number, events: EventState): AlertRow[] {
  const byId = new Map<number, AlertRow>(snapshot.map((row) => [row.id, row]))

  for (const { row, seq } of Object.values(events.rows)) {
    if (seq <= startSeq) continue
    const current = byId.get(row.id)
    if (current === undefined || STATUS_RANK[row.status] >= STATUS_RANK[current.status]) byId.set(row.id, row)
  }

  return [...byId.values()].filter(
    (row) => !events.deletedRules.includes(row.rule_id) && !events.deletedNodes.includes(row.node_id),
  )
}

const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 } as const

const time = (iso: string | null) => (iso === null ? 0 : Date.parse(iso))

/** Sekmede gösterilecek alarmlar, sekmeye uygun sırayla (girdiyi değiştirmez). */
export function alertsForTab(alerts: readonly AlertRow[], tab: AlertStatus): AlertRow[] {
  const rows = alerts.filter((a) => a.status === tab)
  return rows.sort((a, b) => {
    if (tab === 'resolved') return time(b.resolved_at) - time(a.resolved_at) || b.id - a.id
    // Açık/incelenen: önce önem derecesi (kritik en üstte), sonra en yeni.
    return (
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || time(b.triggered_at) - time(a.triggered_at) || b.id - a.id
    )
  })
}

export function countByStatus(alerts: readonly AlertRow[]): Record<AlertStatus, number> {
  const counts: Record<AlertStatus, number> = { open: 0, acknowledged: 0, resolved: 0 }
  for (const a of alerts) counts[a.status]++
  return counts
}
