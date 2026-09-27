import type { AlertRow, AlertStatus } from '../api/types'
import type { AlertEvent } from '../realtime/events'

/**
 * Alert statuses form a one-way ladder: open → acknowledged → resolved. Events can arrive late, repeated
 * or out of order (see docs/decisions.md "Real-time delivery"), so an alert NEVER moves down: only
 * information at the same or a higher step is applied.
 */
export const STATUS_RANK: Record<AlertStatus, number> = { open: 0, acknowledged: 1, resolved: 2 }

/** A row learned from the event stream and the sequence number at which it was learned. */
export interface OverlayEntry {
  row: AlertRow
  seq: number
}

/**
 * `seq` increases with every effective event; it tells which events a REST snapshot already reflects
 * (see mergeAlerts).
 */
export interface EventState {
  seq: number
  rows: Readonly<Record<number, OverlayEntry>>
  /** Ids of deleted rules: their alerts are gone on the server too and are never shown from any source. */
  deletedRules: readonly number[]
  /** Ids of deleted servers: same reason (their alerts go by cascade). */
  deletedNodes: readonly string[]
}

export const initialEventState: EventState = { seq: 0, rows: {}, deletedRules: [], deletedNodes: [] }

export type EventAction =
  | { type: 'alert'; event: AlertEvent }
  | { type: 'ruleDeleted'; ruleId: number }
  | { type: 'nodeDeleted'; nodeId: string }

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
 * Pure reducer. Never mutates its input; a no-op event returns the SAME object so React skips the re-render.
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
  if (existing !== undefined && STATUS_RANK[row.status] < STATUS_RANK[existing.status]) return state // stale or late event

  const seq = state.seq + 1
  return { ...state, seq, rows: { ...state.rows, [row.id]: { row, seq } } }
}

/**
 * Merges the REST `snapshot` with the event state.
 *
 * `startSeq` is the event counter when the snapshot request STARTED. Events received before that are
 * already reflected in the snapshot and are skipped (otherwise a stale copy of a row deleted or changed on
 * the server would linger like a ghost). Events received during or after the request may be missing from
 * the snapshot: they are applied, but only if they are not below the snapshot's status (ladder rule).
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

/** Alerts for a tab, in that tab's order (does not mutate the input). */
export function alertsForTab(alerts: readonly AlertRow[], tab: AlertStatus): AlertRow[] {
  const rows = alerts.filter((a) => a.status === tab)
  return rows.sort((a, b) => {
    if (tab === 'resolved') return time(b.resolved_at) - time(a.resolved_at) || b.id - a.id
    // Open/acknowledged: severity first (critical on top), then newest.
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
