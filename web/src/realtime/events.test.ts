import { describe, expect, it } from 'vitest'
import { metricEvent } from '../test/fakeWebSocket'
import { alertEventPayload } from '../test/fixtures'
import { parseEvent } from './events'

describe('parseEvent', () => {
  it('geçerli metric olayını çözer; load1 yoksa null olur', () => {
    const ev = parseEvent(JSON.stringify(metricEvent('n1', '2030-01-01T00:00:00Z')))
    expect(ev).toEqual({
      type: 'metric',
      node_id: 'n1',
      time: '2030-01-01T00:00:00Z',
      cpu_percent: 10,
      mem_percent: 20,
      mem_used_bytes: 1000,
      disk_percent: 30,
      net_rx_bps: 100,
      net_tx_bps: 50,
      load1: null,
    })
  })

  it('load1 sayı ise korunur', () => {
    const ev = parseEvent(JSON.stringify(metricEvent('n1', '2030-01-01T00:00:00Z', { load1: 1.5 })))
    expect(ev).toMatchObject({ load1: 1.5 })
  })

  it('alarm olayını çözer: satırın tüm alanları taşınır, eksik zaman/kullanıcı null olur', () => {
    const ev = parseEvent(JSON.stringify(alertEventPayload({ id: 7, node_name: 'db-01' })))
    expect(ev).toMatchObject({
      type: 'alert',
      event: 'opened',
      alert_id: 7,
      id: 7,
      node_name: 'db-01',
      operator: '>',
      threshold: 90,
      status: 'open',
      acknowledged_at: null,
      acknowledged_by: null,
      resolved_at: null,
    })
  })

  it('incelemeye alınmış alarm olayı kullanıcıyı ve zamanı taşır', () => {
    const ev = parseEvent(
      JSON.stringify(
        alertEventPayload({
          event: 'acknowledged',
          status: 'acknowledged',
          acknowledged_by: 'Ada Test',
          acknowledged_at: '2030-01-01T10:05:00Z',
        }),
      ),
    )
    expect(ev).toMatchObject({ status: 'acknowledged', acknowledged_by: 'Ada Test', acknowledged_at: '2030-01-01T10:05:00Z' })
  })

  it('kural silindi olayını çözer', () => {
    expect(parseEvent(JSON.stringify({ type: 'rule', event: 'deleted', rule_id: 5 }))).toEqual({
      type: 'rule',
      event: 'deleted',
      rule_id: 5,
    })
  })

  it('sunucu silindi olayını çözer', () => {
    expect(parseEvent(JSON.stringify({ type: 'node', event: 'deleted', node_id: 'n1' }))).toEqual({
      type: 'node',
      event: 'deleted',
      node_id: 'n1',
    })
  })

  it.each([
    ['metin değil', 42],
    ['json değil', '{bozuk'],
    ['nesne değil', '[1,2]'],
    ['bilinmeyen tür', JSON.stringify({ type: 'x' })],
    ['node_id yok', JSON.stringify({ ...metricEvent('n1', '2030-01-01T00:00:00Z'), node_id: undefined })],
    ['geçersiz zaman', JSON.stringify(metricEvent('n1', 'dün'))],
    ['sayı yerine metin', JSON.stringify(metricEvent('n1', '2030-01-01T00:00:00Z', { mem_percent: '20' }))],
    ['alarmda alert_id yok', JSON.stringify({ ...alertEventPayload(), alert_id: undefined })],
    ['alarmda node_name yok', JSON.stringify({ ...alertEventPayload(), node_name: undefined })],
    ['alarmda bilinmeyen durum', JSON.stringify(alertEventPayload({ status: 'yok' as never }))],
    ['alarmda bilinmeyen önem', JSON.stringify(alertEventPayload({ severity: 'felaket' as never }))],
    ['alarmda geçersiz zaman', JSON.stringify(alertEventPayload({ triggered_at: 'dün' }))],
    ['alarmda eşik sayı değil', JSON.stringify({ ...alertEventPayload(), threshold: '90' })],
    ['kural olayı: bilinmeyen tür', JSON.stringify({ type: 'rule', event: 'created', rule_id: 5 })],
    ['kural olayı: rule_id yok', JSON.stringify({ type: 'rule', event: 'deleted' })],
    ['sunucu olayı: node_id yok', JSON.stringify({ type: 'node', event: 'deleted' })],
    ['sunucu olayı: node_id boş', JSON.stringify({ type: 'node', event: 'deleted', node_id: '' })],
    ['sunucu olayı: bilinmeyen tür', JSON.stringify({ type: 'node', event: 'created', node_id: 'n1' })],
  ])('reddeder: %s', (_name, raw) => {
    expect(parseEvent(raw)).toBeNull()
  })
})
