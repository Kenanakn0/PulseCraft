import { describe, expect, it } from 'vitest'
import { aggPoint, aggResponse, rawPoint, rawResponse } from '../test/fixtures'
import { clampPercent, formatBytesRate, gaugeLevel } from './format'
import { DEFAULT_RANGE, getRange, parseRangeId, RANGES } from './ranges'
import { capPoints, MAX_POINTS, toChartPoints, type ChartPoint } from './series'

describe('formatBytesRate', () => {
  it.each([
    [0, '0 B/s'],
    [1023, '1.023 B/s'],
    [1024, '1 KB/s'],
    [1536, '1,5 KB/s'],
    [1024 * 1024 - 1, '1.024 KB/s'],
    [1024 * 1024, '1 MB/s'],
    [5.5 * 1024 * 1024, '5,5 MB/s'],
    [3 * 1024 ** 3, '3 GB/s'],
  ])('%s → %s', (input, expected) => {
    expect(formatBytesRate(input)).toBe(expected)
  })
})

describe('gaugeLevel / clampPercent', () => {
  it.each([
    [0, 'ok'],
    [69.99, 'ok'],
    [70, 'warn'],
    [89.99, 'warn'],
    [90, 'crit'],
    [100, 'crit'],
  ])('%s → %s', (value, level) => {
    expect(gaugeLevel(value)).toBe(level)
  })

  it('yüzde dışı değerleri 0-100 aralığına sıkıştırır', () => {
    expect(clampPercent(-5)).toBe(0)
    expect(clampPercent(42.5)).toBe(42.5)
    expect(clampPercent(140)).toBe(100)
  })
})

describe('aralıklar', () => {
  it('bilinen aralıkları kabul eder, bilinmeyeni/boşu varsayılana düşürür', () => {
    expect(parseRangeId('1h')).toBe('1h')
    expect(parseRangeId('24h')).toBe('24h')
    for (const bad of [null, '', 'zzz', '2h', '15M', '1h; drop']) expect(parseRangeId(bad)).toBe(DEFAULT_RANGE)
  })

  it('her aralığın sunucuya gönderilen süresi kendi kimliğiyle aynıdır; uzun aralıklar daha seyrek yenilenir', () => {
    for (const r of RANGES) expect(getRange(r.id).last).toBe(r.id)
    expect(getRange('15m').pollMs).toBeLessThan(getRange('6h').pollMs)
    expect(getRange('1h').pollMs).toBeLessThan(getRange('24h').pollMs)
  })
})

describe('toChartPoints', () => {
  it('ham veriyi ortak biçime çevirir', () => {
    const points = toChartPoints(
      rawResponse([rawPoint('2030-01-01T00:00:00Z', { cpu_percent: 12, mem_percent: 34, disk_percent: 56, net_rx_bps: 7, net_tx_bps: 8 })]),
    )
    expect(points).toEqual([{ t: Date.parse('2030-01-01T00:00:00Z'), cpu: 12, mem: 34, disk: 56, rx: 7, tx: 8 }])
  })

  it('1 dakikalık özeti (ortalamaları) aynı biçime çevirir', () => {
    const points = toChartPoints(
      aggResponse([aggPoint('2030-01-01T00:00:00Z', { cpu_avg: 1, mem_avg: 2, disk_avg: 3, net_rx_avg: 4, net_tx_avg: 5 })]),
    )
    expect(points).toEqual([{ t: Date.parse('2030-01-01T00:00:00Z'), cpu: 1, mem: 2, disk: 3, rx: 4, tx: 5 }])
  })

  it('zamana göre sıralar; geçersiz (sayı olmayan) satırları atar', () => {
    const points = toChartPoints(
      rawResponse([
        rawPoint('2030-01-01T00:00:10Z'),
        rawPoint('2030-01-01T00:00:00Z'),
        rawPoint('bozuk-zaman'),
        rawPoint('2030-01-01T00:00:05Z', { cpu_percent: Number.NaN }),
      ]),
    )
    expect(points.map((p) => p.t)).toEqual([Date.parse('2030-01-01T00:00:00Z'), Date.parse('2030-01-01T00:00:10Z')])
  })

  it('boş yanıtı boş dizi yapar', () => {
    expect(toChartPoints(rawResponse([]))).toEqual([])
  })
})

describe('capPoints', () => {
  const make = (n: number): ChartPoint[] =>
    Array.from({ length: n }, (_, i) => ({ t: i * 1000, cpu: i, mem: 0, disk: 0, rx: 0, tx: 0 }))

  it('sınırın altındaki diziyi olduğu gibi (kopya olarak) döndürür', () => {
    const input = make(10)
    const out = capPoints(input, 10)
    expect(out).toEqual(input)
    expect(out).not.toBe(input)
  })

  it('sınırı aşan diziyi seyreltir, ilk ve SON noktayı korur, sırayı bozmaz', () => {
    const input = make(10_000)
    const out = capPoints(input, 1000)

    expect(out.length).toBeLessThanOrEqual(1001) // son noktanın eklenmesi için +1
    expect(out[0]).toBe(input[0])
    expect(out[out.length - 1]).toBe(input[input.length - 1])
    expect(out.map((p) => p.t)).toEqual([...out.map((p) => p.t)].sort((a, b) => a - b))
  })

  it('girdiyi değiştirmez', () => {
    const input = make(5000)
    const snapshot = [...input]
    capPoints(input, 100)
    expect(input).toEqual(snapshot)
  })

  it('varsayılan tavan MAX_POINTS\'tir; toChartPoints devasa yanıtı sınırlar', () => {
    const many = Array.from({ length: MAX_POINTS * 3 }, (_, i) => rawPoint(new Date(1_900_000_000_000 + i * 1000).toISOString()))
    expect(toChartPoints(rawResponse(many)).length).toBeLessThanOrEqual(MAX_POINTS + 1)
  })
})
