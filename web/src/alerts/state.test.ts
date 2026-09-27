import { describe, expect, it } from 'vitest'
import type { AlertRow } from '../api/types'
import type { AlertEvent } from '../realtime/events'
import { makeAlert } from '../test/fixtures'
import { alertsForTab, countByStatus, eventReducer, initialEventState, mergeAlerts, toRow, type EventState } from './state'

const event = (overrides: Partial<AlertRow> = {}, name = 'opened'): AlertEvent => {
  const row = makeAlert(overrides)
  return { ...row, type: 'alert', event: name, alert_id: row.id }
}

const apply = (state: EventState, ...events: AlertEvent[]) =>
  events.reduce((s, e) => eventReducer(s, { type: 'alert', event: e }), state)

describe('eventReducer', () => {
  it('bilinmeyen alarmı olaydan kurar (REST\'e gitmeden)', () => {
    const state = apply(initialEventState, event({ id: 5, node_name: 'db-01' }))
    expect(state.rows[5]?.row).toMatchObject({ id: 5, node_name: 'db-01', status: 'open' })
    expect(state.seq).toBe(1)
  })

  it('merdiven: open → acknowledged → resolved uygulanır', () => {
    const state = apply(
      initialEventState,
      event({ id: 1 }),
      event({ id: 1, status: 'acknowledged', acknowledged_by: 'Ada', acknowledged_at: '2030-01-01T10:05:00Z' }, 'acknowledged'),
      event({ id: 1, status: 'resolved', resolved_at: '2030-01-01T10:10:00Z' }, 'resolved'),
    )
    expect(state.rows[1]?.row.status).toBe('resolved')
  })

  it('geç/eski olay alarmı GERİ ALMAZ', () => {
    const acked = event({ id: 1, status: 'acknowledged', acknowledged_by: 'Ada' }, 'acknowledged')
    const before = apply(initialEventState, acked)

    const after = apply(before, event({ id: 1 })) // geç gelen "opened"
    expect(after).toBe(before) // etkisiz olayda AYNI nesne (gereksiz yeniden çizim yok)
    expect(after.rows[1]?.row.acknowledged_by).toBe('Ada')

    const resolved = apply(before, event({ id: 1, status: 'resolved', acknowledged_by: 'Ada', resolved_at: '2030-01-01T10:10:00Z' }, 'resolved'))
    expect(apply(resolved, acked).rows[1]?.row.status).toBe('resolved')
  })

  it('tekrarlı olay aynı sonucu verir (idempotent)', () => {
    const e = event({ id: 1, status: 'acknowledged', acknowledged_by: 'Ada' }, 'acknowledged')
    const once = apply(initialEventState, e)
    const twice = apply(once, e)
    expect(twice.rows[1]?.row).toEqual(once.rows[1]?.row)
  })

  it('kural silinince ona bağlı satırlar atılır ve o kuralın sonraki olayları yok sayılır', () => {
    let state = apply(initialEventState, event({ id: 1, rule_id: 10 }), event({ id: 2, rule_id: 11 }))
    state = eventReducer(state, { type: 'ruleDeleted', ruleId: 10 })

    expect(Object.keys(state.rows)).toEqual(['2'])
    expect(state.deletedRules).toEqual([10])

    const late = apply(state, event({ id: 3, rule_id: 10 }))
    expect(late).toBe(state)
    expect(eventReducer(state, { type: 'ruleDeleted', ruleId: 10 })).toBe(state) // tekrar: etkisiz
  })

  it('girdiyi DEĞİŞTİRMEZ', () => {
    const state = apply(initialEventState, event({ id: 1 }))
    const snapshot = structuredClone(state)
    eventReducer(state, { type: 'alert', event: event({ id: 2 }) })
    eventReducer(state, { type: 'ruleDeleted', ruleId: 10 })
    expect(state).toEqual(snapshot)
  })

  it('toRow olayı alarm satırına çevirir', () => {
    const e = event({ id: 9, status: 'acknowledged', acknowledged_by: 'Ada' })
    const row = toRow(e)
    expect(row).toMatchObject({ id: 9, acknowledged_by: 'Ada' })
    expect(row).not.toHaveProperty('type')
    expect(row).not.toHaveProperty('alert_id')
  })
})

describe('eventReducer: sunucu silindi', () => {
  it('o sunucunun satırlarını atar ve sonraki olaylarını yok sayar; tekrarı etkisizdir', () => {
    let state = apply(initialEventState, event({ id: 1, node_id: 'a' }), event({ id: 2, node_id: 'b' }))
    state = eventReducer(state, { type: 'nodeDeleted', nodeId: 'a' })

    expect(Object.keys(state.rows)).toEqual(['2'])
    expect(state.deletedNodes).toEqual(['a'])
    expect(apply(state, event({ id: 3, node_id: 'a' }))).toBe(state)
    expect(eventReducer(state, { type: 'nodeDeleted', nodeId: 'a' })).toBe(state)
  })

  it('kural silindi, önceden silinmiş sunucu listesini kaybetmez (ve tersi)', () => {
    let state = eventReducer(initialEventState, { type: 'nodeDeleted', nodeId: 'a' })
    state = eventReducer(state, { type: 'ruleDeleted', ruleId: 10 })
    expect(state.deletedNodes).toEqual(['a'])
    expect(state.deletedRules).toEqual([10])
  })
})

describe('mergeAlerts', () => {
  it('olay yoksa anlık görüntüyü aynen verir', () => {
    const snapshot = [makeAlert({ id: 1 }), makeAlert({ id: 2 })]
    expect(mergeAlerts(snapshot, 0, initialEventState)).toEqual(snapshot)
  })

  it('anlık görüntü İSTEĞİ SIRASINDA gelen yeni alarm kaybolmaz', () => {
    const snapshot = [makeAlert({ id: 1 })] // istek başladığında (seq 0) 1 vardı
    const state = apply(initialEventState, event({ id: 2 })) // istek sürerken 2 açıldı (seq 1)
    expect(mergeAlerts(snapshot, 0, state).map((a) => a.id).sort()).toEqual([1, 2])
  })

  it('anlık görüntü İSTEKTEN ÖNCE alınan olayları geçersiz kılar: sunucuda olmayan satır hayalet kalmaz', () => {
    const state = apply(initialEventState, event({ id: 2 })) // seq 1
    // Sonraki eşitleme, olay alındıktan SONRA başladı (startSeq = 1) ve alarm 2'yi içermiyor (silinmiş).
    expect(mergeAlerts([makeAlert({ id: 1 })], 1, state).map((a) => a.id)).toEqual([1])
  })

  it('istek sırasında gelen olay, anlık görüntüdeki DAHA İLERİ durumu geri almaz', () => {
    const state = apply(initialEventState, event({ id: 1 })) // olay: open (seq 1)
    const snapshot = [makeAlert({ id: 1, status: 'resolved', resolved_at: '2030-01-01T10:10:00Z' })]
    expect(mergeAlerts(snapshot, 0, state)[0]?.status).toBe('resolved')
  })

  it('istek sırasında gelen olay, anlık görüntüdeki geride kalan satırı ilerletir', () => {
    const state = apply(initialEventState, event({ id: 1, status: 'acknowledged', acknowledged_by: 'Ada' }, 'acknowledged'))
    expect(mergeAlerts([makeAlert({ id: 1 })], 0, state)[0]).toMatchObject({ status: 'acknowledged', acknowledged_by: 'Ada' })
  })

  it('silinen sunucunun alarmları (geçmiş dahil) hiçbir kaynaktan gösterilmez', () => {
    const state = eventReducer(initialEventState, { type: 'nodeDeleted', nodeId: 'a' })
    const snapshot = [
      makeAlert({ id: 1, node_id: 'a' }),
      makeAlert({ id: 2, node_id: 'a', status: 'resolved', resolved_at: '2030-01-01T10:10:00Z' }),
      makeAlert({ id: 3, node_id: 'b' }),
    ]
    expect(mergeAlerts(snapshot, 0, state).map((a) => a.id)).toEqual([3])
  })

  it('silinen kuralın alarmları hiçbir kaynaktan gösterilmez', () => {
    const state = eventReducer(initialEventState, { type: 'ruleDeleted', ruleId: 10 })
    const snapshot = [makeAlert({ id: 1, rule_id: 10 }), makeAlert({ id: 2, rule_id: 11 })]
    expect(mergeAlerts(snapshot, 0, state).map((a) => a.id)).toEqual([2])
  })
})

describe('sekme seçicileri', () => {
  it('açık/incelenen: önce kritik, aynı önemde en yeni üstte', () => {
    const alerts = [
      makeAlert({ id: 1, severity: 'info', triggered_at: '2030-01-01T10:09:00Z' }),
      makeAlert({ id: 2, severity: 'critical', triggered_at: '2030-01-01T10:01:00Z' }),
      makeAlert({ id: 3, severity: 'critical', triggered_at: '2030-01-01T10:05:00Z' }),
      makeAlert({ id: 4, severity: 'warning', triggered_at: '2030-01-01T10:08:00Z' }),
    ]
    expect(alertsForTab(alerts, 'open').map((a) => a.id)).toEqual([3, 2, 4, 1])
  })

  it('çözülen: en son çözülen üstte', () => {
    const alerts = [
      makeAlert({ id: 1, status: 'resolved', resolved_at: '2030-01-01T10:01:00Z' }),
      makeAlert({ id: 2, status: 'resolved', resolved_at: '2030-01-01T10:09:00Z' }),
    ]
    expect(alertsForTab(alerts, 'resolved').map((a) => a.id)).toEqual([2, 1])
  })

  it('yalnızca o durumdakileri seçer ve girdiyi değiştirmez', () => {
    const alerts = [makeAlert({ id: 1 }), makeAlert({ id: 2, status: 'resolved', resolved_at: '2030-01-01T10:09:00Z' })]
    const copy = structuredClone(alerts)
    expect(alertsForTab(alerts, 'acknowledged')).toEqual([])
    expect(alertsForTab(alerts, 'open').map((a) => a.id)).toEqual([1])
    expect(alerts).toEqual(copy)
  })

  it('countByStatus her durumu sayar', () => {
    const alerts = [
      makeAlert({ id: 1 }),
      makeAlert({ id: 2 }),
      makeAlert({ id: 3, status: 'acknowledged' }),
      makeAlert({ id: 4, status: 'resolved' }),
    ]
    expect(countByStatus(alerts)).toEqual({ open: 2, acknowledged: 1, resolved: 1 })
    expect(countByStatus([])).toEqual({ open: 0, acknowledged: 0, resolved: 0 })
  })
})
