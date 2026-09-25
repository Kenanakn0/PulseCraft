import { describe, expect, it } from 'vitest'
import { emptyRuleForm, toRulePayload, validateRuleForm, type RuleFormValues } from './form'

const values = (overrides: Partial<RuleFormValues> = {}): RuleFormValues => ({
  ...emptyRuleForm,
  name: 'Yüksek CPU',
  threshold: '90',
  ...overrides,
})

describe('validateRuleForm', () => {
  it('geçerli girdide null döner', () => {
    expect(validateRuleForm(values())).toBeNull()
  })

  it.each([
    ['', 'Kural adı zorunlu.'],
    ['   ', 'Kural adı zorunlu.'],
  ])('ad boşsa (%j) reddeder', (name, message) => {
    expect(validateRuleForm(values({ name }))).toBe(message)
  })

  it.each([
    ['', 'Eşik geçerli bir sayı olmalı.'],
    ['   ', 'Eşik geçerli bir sayı olmalı.'],
    ['abc', 'Eşik geçerli bir sayı olmalı.'],
    ['NaN', 'Eşik geçerli bir sayı olmalı.'],
    ['Infinity', 'Eşik geçerli bir sayı olmalı.'],
  ])('geçersiz eşiği (%j) reddeder', (threshold, message) => {
    expect(validateRuleForm(values({ threshold }))).toBe(message)
  })

  it.each(['90', '-5', '0', '12.5'])('sayısal her eşiği kabul eder: %s', (threshold) => {
    expect(validateRuleForm(values({ threshold }))).toBeNull()
  })

  it.each([
    ['', 'Süre, 0 veya daha büyük bir tam sayı (saniye) olmalı.'],
    ['-1', 'Süre, 0 veya daha büyük bir tam sayı (saniye) olmalı.'],
    ['1.5', 'Süre, 0 veya daha büyük bir tam sayı (saniye) olmalı.'],
    ['abc', 'Süre, 0 veya daha büyük bir tam sayı (saniye) olmalı.'],
  ])('geçersiz süreyi (%j) reddeder', (durationSeconds, message) => {
    expect(validateRuleForm(values({ durationSeconds }))).toBe(message)
  })

  it('sıfır süreyi kabul eder', () => {
    expect(validateRuleForm(values({ durationSeconds: '0' }))).toBeNull()
  })
})

describe('toRulePayload', () => {
  it('metin alanları sayıya, boş sunucuyu null\'a çevirir; adı kırpar', () => {
    expect(toRulePayload(values({ name: '  Yüksek CPU  ', threshold: '90.5', durationSeconds: '60' }))).toEqual({
      name: 'Yüksek CPU',
      node_id: null,
      metric: 'cpu_percent',
      operator: '>',
      threshold: 90.5,
      duration_seconds: 60,
      severity: 'warning',
      enabled: true,
    })
  })

  it('seçili sunucu id\'sini korur', () => {
    expect(toRulePayload(values({ nodeId: 'node-1' })).node_id).toBe('node-1')
  })

  it('enabled parametresi varsayılan true, verilirse onu kullanır', () => {
    expect(toRulePayload(values()).enabled).toBe(true)
    expect(toRulePayload(values(), false).enabled).toBe(false)
  })
})
