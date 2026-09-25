import { describe, expect, it } from 'vitest'
import { makeRule } from '../test/fixtures'
import { formatCondition } from './format'

describe('formatCondition', () => {
  it('süresiz (duration 0) kuralda süre gösterilmez', () => {
    expect(formatCondition(makeRule({ metric: 'cpu_percent', operator: '>', threshold: 90, duration_seconds: 0 }))).toBe(
      'CPU > 90 %',
    )
  })

  it('süreli kuralda süre eklenir', () => {
    expect(
      formatCondition(makeRule({ metric: 'disk_percent', operator: '<=', threshold: 15.5, duration_seconds: 60 })),
    ).toBe('Disk <= 15,5 % (60 sn boyunca)')
  })

  it('bilinmeyen metrik adı olduğu gibi gösterilir', () => {
    expect(formatCondition(makeRule({ metric: 'yeni_metrik' }))).toContain('yeni_metrik')
  })
})
