import { describe, expect, it } from 'vitest'
import { formatDateTime, formatDuration, formatTrigger, metricLabel } from './format'

describe('formatDuration', () => {
  const from = '2030-01-01T10:00:00Z'
  it.each([
    ['2030-01-01T10:00:00Z', '0 sn'],
    ['2030-01-01T10:00:45Z', '45 sn'],
    ['2030-01-01T10:01:00Z', '1 dk'],
    ['2030-01-01T10:12:05Z', '12 dk 5 sn'],
    ['2030-01-01T12:00:00Z', '2 sa'],
    ['2030-01-01T12:03:20Z', '2 sa 3 dk'],
    ['2030-01-02T10:00:00Z', '1 gün'],
    ['2030-01-02T14:30:00Z', '1 gün 4 sa'],
  ])('%s → %s', (to, expected) => {
    expect(formatDuration(from, to)).toBe(expected)
  })

  it('bitiş başlangıçtan önceyse (saat sapması) negatif göstermez', () => {
    expect(formatDuration('2030-01-01T10:00:10Z', '2030-01-01T10:00:00Z')).toBe('0 sn')
  })
})

describe('formatTrigger / metricLabel', () => {
  it('CPU değerini ve eşiği Türkçe biçimler', () => {
    expect(formatTrigger({ metric: 'cpu_percent', trigger_value: 93.2, operator: '>', threshold: 90 })).toBe(
      'CPU 93,2 % (eşik > 90 %)',
    )
  })

  it('ondalıklı eşik ve farklı işleç', () => {
    expect(formatTrigger({ metric: 'disk_percent', trigger_value: 12, operator: '<=', threshold: 15.5 })).toBe(
      'Disk 12,0 % (eşik <= 15,5 %)',
    )
  })

  it('bilinmeyen metrik adı olduğu gibi gösterilir', () => {
    expect(metricLabel('mem_percent')).toBe('RAM')
    expect(metricLabel('yeni_metrik')).toBe('yeni_metrik')
  })
})

describe('formatDateTime', () => {
  it('mutlak zamanı verilen saat diliminde biçimler', () => {
    expect(formatDateTime('2030-01-01T10:05:09Z', 'UTC')).toBe('01.01.2030 10:05:09')
    expect(formatDateTime('2030-01-01T10:05:09Z', 'Europe/Istanbul')).toBe('01.01.2030 13:05:09')
  })
})
