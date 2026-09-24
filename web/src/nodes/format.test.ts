import { describe, expect, it } from 'vitest'
import { makeNode } from '../test/fixtures'
import { formatAge, formatPercent, sortNodes } from './format'

describe('formatPercent', () => {
  it('Türkçe ondalık ayracıyla tek basamak gösterir', () => {
    expect(formatPercent(42.5)).toBe('42,5 %')
    expect(formatPercent(0)).toBe('0,0 %')
    expect(formatPercent(12.345)).toBe('12,3 %')
    expect(formatPercent(100)).toBe('100,0 %')
  })
})

describe('formatAge', () => {
  it.each([
    [null, 'hiç görülmedi'],
    [0, 'az önce'],
    [4.9, 'az önce'],
    [5, '5 sn önce'],
    [59.9, '59 sn önce'],
    [60, '1 dk önce'],
    [3599, '59 dk önce'],
    [3600, '1 sa önce'],
    [86399, '23 sa önce'],
    [86400, '1 gün önce'],
    [3 * 86400 + 500, '3 gün önce'],
  ])('%s → "%s"', (seconds, expected) => {
    expect(formatAge(seconds)).toBe(expected)
  })
})

describe('sortNodes', () => {
  it('çevrimiçi olanlar önce gelir, kendi içinde ada göre (Türkçe sıralama)', () => {
    const nodes = [
      makeNode({ id: '1', name: 'zeta', online: false }),
      makeNode({ id: '2', name: 'Çiçek', online: true }),
      makeNode({ id: '3', name: 'alfa', online: true }),
      makeNode({ id: '4', name: 'beta', online: false }),
      makeNode({ id: '5', name: 'Cem', online: true }),
    ]

    // Türkçe alfabede: a < c < ç.
    expect(sortNodes(nodes).map((n) => n.name)).toEqual(['alfa', 'Cem', 'Çiçek', 'beta', 'zeta'])
  })

  it('verilen diziyi DEĞİŞTİRMEZ (yeni bir dizi döndürür)', () => {
    const nodes = [makeNode({ id: '1', name: 'b', online: false }), makeNode({ id: '2', name: 'a', online: true })]
    const before = nodes.map((n) => n.id)

    const sorted = sortNodes(nodes)

    expect(nodes.map((n) => n.id)).toEqual(before)
    expect(sorted).not.toBe(nodes)
  })
})
