import { describe, expect, it } from 'vitest'
import { metricEvent } from '../test/fakeWebSocket'
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

  it('alarm olayını çözer', () => {
    const raw = JSON.stringify({ type: 'alert', event: 'opened', alert_id: 7, node_id: 'n1', status: 'open' })
    expect(parseEvent(raw)).toMatchObject({ type: 'alert', event: 'opened', alert_id: 7 })
  })

  it.each([
    ['metin değil', 42],
    ['json değil', '{bozuk'],
    ['nesne değil', '[1,2]'],
    ['bilinmeyen tür', JSON.stringify({ type: 'x' })],
    ['node_id yok', JSON.stringify({ ...metricEvent('n1', '2030-01-01T00:00:00Z'), node_id: undefined })],
    ['geçersiz zaman', JSON.stringify(metricEvent('n1', 'dün'))],
    ['sayı yerine metin', JSON.stringify(metricEvent('n1', '2030-01-01T00:00:00Z', { mem_percent: '20' }))],
    ['alarmda alert_id yok', JSON.stringify({ type: 'alert', event: 'opened', node_id: 'n1' })],
  ])('reddeder: %s', (_name, raw) => {
    expect(parseEvent(raw)).toBeNull()
  })
})
