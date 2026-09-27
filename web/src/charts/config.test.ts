import { describe, expect, it } from 'vitest'
import { readChartTheme } from './theme'
import {
  buildGaugeData,
  buildLineData,
  buildLineOptions,
  DECIMATION_SAMPLES,
  Y_AXIS_WIDTH,
  gapThresholdMs,
  gaugeOptions,
} from './config'

const theme = readChartTheme() // jsdom has no CSS variables: default colours

const options = () =>
  buildLineOptions({ from: 1000, to: 2000, theme, yMax: 100, formatY: (v) => `<${v}>`, showLegend: true })

describe('buildLineOptions (canlı güncellenen grafik ayarları)', () => {
  it('animasyon KAPALI', () => {
    expect(options().animation).toBe(false)
  })

  it('veri zaten {x,y} ve sıralı: ayrıştırma kapalı, normalized açık', () => {
    expect(options()).toMatchObject({ parsing: false, normalized: true })
  })

  it('nokta sayısı sınırlı: decimation (LTTB) açık ve hedef örnek sayısı sabit', () => {
    expect(options().plugins?.decimation).toEqual({ enabled: true, algorithm: 'lttb', samples: DECIMATION_SAMPLES })
    expect(DECIMATION_SAMPLES).toBeLessThanOrEqual(500)
  })

  it('x ekseni SUNUCUnun verdiği pencereye sabitlenir (zaman ekseni)', () => {
    const x = options().scales?.x
    expect(x).toMatchObject({ type: 'time', min: 1000, max: 2000 })
  })

  it('y ekseni 0\'dan başlar; yMax verilirse tavan olur, verilmezse otomatik', () => {
    expect(options().scales?.y).toMatchObject({ min: 0, max: 100 })
    const auto = buildLineOptions({ from: 0, to: 1, theme, formatY: String, showLegend: false })
    expect(auto.scales?.y).toMatchObject({ min: 0 })
    expect(auto.scales?.y).not.toHaveProperty('max')
  })

  it('eksen etiketleri ve ipucu (tooltip) biçimleyiciyi kullanır', () => {
    const y = options().scales?.y as { ticks: { callback: (v: number) => string } }
    expect(y.ticks.callback(42)).toBe('<42>')

    const label = options().plugins?.tooltip?.callbacks?.label as (ctx: unknown) => string
    expect(label({ dataset: { label: 'CPU' }, parsed: { y: 7 } })).toBe('CPU: <7>')
  })

  it('y ekseni genişliği etiketlerden bağımsız SABİT (alt alta grafikler hizalı)', () => {
    for (const formatY of [(v: number) => `${v}%`, (v: number) => `${v},9 MB/s uzun bir etiket`]) {
      const y = buildLineOptions({ from: 0, to: 1, theme, formatY, showLegend: false }).scales?.y as {
        afterFit: (axis: { width: number }) => void
      }
      const axis = { width: 12 }
      y.afterFit(axis)
      expect(axis.width).toBe(Y_AXIS_WIDTH)
    }
  })

  it('lejant yalnızca birden çok seri varken görünür', () => {
    expect(options().plugins?.legend?.display).toBe(true)
    expect(buildLineOptions({ from: 0, to: 1, theme, formatY: String, showLegend: false }).plugins?.legend?.display).toBe(false)
  })
})

describe('buildLineData', () => {
  it('her seri için nokta işareti çizmez ve kesinti boşluklarını birleştirmez', () => {
    const data = buildLineData([{ label: 'CPU', color: '#123456', data: [{ x: 1, y: 2 }] }], 'raw')
    expect(data.datasets[0]).toMatchObject({
      label: 'CPU',
      borderColor: '#123456',
      pointRadius: 0,
      spanGaps: gapThresholdMs('raw'),
      data: [{ x: 1, y: 2 }],
    })
  })

  it('özet (1 dk) verisinde boşluk eşiği ham veriden büyüktür', () => {
    expect(gapThresholdMs('1m')).toBeGreaterThan(gapThresholdMs('raw'))
  })
})

describe('gösterge (gauge)', () => {
  it('dolu kısım eşiğe göre renklenir, kalanı iz rengindedir', () => {
    const color = (v: number) => buildGaugeData(v, theme).datasets[0]?.backgroundColor
    expect(color(30)).toEqual([theme.ok, theme.track])
    expect(color(75)).toEqual([theme.warn, theme.track])
    expect(color(95)).toEqual([theme.crit, theme.track])
  })

  it('değer 0-100 dışındaysa sıkıştırılır (toplam her zaman 100)', () => {
    expect(buildGaugeData(140, theme).datasets[0]?.data).toEqual([100, 0])
    expect(buildGaugeData(-3, theme).datasets[0]?.data).toEqual([0, 100])
    expect(buildGaugeData(42.5, theme).datasets[0]?.data).toEqual([42.5, 57.5])
  })

  it('yarım daire, animasyonsuz ve etkileşimsizdir', () => {
    expect(gaugeOptions).toMatchObject({ circumference: 180, rotation: -90, animation: false, events: [] })
  })
})
