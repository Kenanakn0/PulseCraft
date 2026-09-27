import type { ChartData, ChartOptions } from 'chart.js'
import { tr } from 'date-fns/locale/tr'
import { clampPercent, gaugeLevel } from '../metrics/format'
import type { ChartTheme } from './theme'

/** Çizgi grafiğindeki bir seri (ör. "CPU"). */
export interface LineSeries {
  label: string
  color: string
  /** Sıralı noktalar; x = zaman (ms), y = değer. */
  data: { x: number; y: number }[]
}

/** Chart.js'in decimation (LTTB) ile çizim için indireceği hedef nokta sayısı. */
export const DECIMATION_SAMPLES = 300

/**
 * Bu süreden uzun aralıklarla ayrılmış iki nokta ÇİZGİYLE BİRLEŞTİRİLMEZ (sunucu/agent kesintisi
 * boşluk olarak görünür; aksi halde kesinti sırasında yalancı, düz bir çizgi çizilirdi).
 */
export function gapThresholdMs(resolution: 'raw' | '1m'): number {
  return resolution === 'raw' ? 60_000 : 5 * 60_000
}

export function buildLineData(series: LineSeries[], resolution: 'raw' | '1m'): ChartData<'line', { x: number; y: number }[]> {
  return {
    datasets: series.map((s) => ({
      label: s.label,
      data: s.data,
      borderColor: s.color,
      backgroundColor: s.color,
      borderWidth: 1.5,
      pointRadius: 0, // binlerce noktayı tek tek işaretleme (hem yavaş hem karmaşık)
      pointHoverRadius: 3,
      spanGaps: gapThresholdMs(resolution),
    })),
  }
}

interface LineOptionsInput {
  /** x ekseni sınırları (ms): SUNUCUnun döndürdüğü pencere. */
  from: number
  to: number
  theme: ChartTheme
  /** y ekseni üst sınırı; verilmezse veriye göre otomatik (alt sınır her zaman 0). */
  yMax?: number
  formatY: (value: number) => string
  showLegend: boolean
}

/**
 * y ekseninin SABİT genişliği (px). Chart.js ekseni etiketlerin uzunluğuna göre boyutlar: "100%" ile
 * "341,8 KB/s" farklı genişlikte olduğundan alt alta duran iki grafiğin çizim alanları (ve x eksenleri) kayıyordu.
 * En uzun etiket ("1.023,9 MB/s") bu genişliğe sığar.
 */
export const Y_AXIS_WIDTH = 84

/**
 * Canlı güncellenen grafikler için seçenekler:
 *  - `animation: false`  → her güncellemede kayan/oynayan animasyon YOK
 *  - `parsing: false` + `normalized: true` → veri zaten {x,y} ve sıralı; Chart.js ayrıca ayrıştırma yapmaz
 *  - `decimation` (LTTB) → çok nokta varsa çizim yalnızca ~DECIMATION_SAMPLES noktayla yapılır
 */
export function buildLineOptions({ from, to, theme, yMax, formatY, showLegend }: LineOptionsInput): ChartOptions<'line'> {
  return {
    responsive: true,
    maintainAspectRatio: false, // yüksekliği kapsayıcı (CSS) belirler
    animation: false,
    parsing: false,
    normalized: true,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: {
        type: 'time',
        min: from,
        max: to,
        adapters: { date: { locale: tr } },
        time: {
          tooltipFormat: 'd MMM HH:mm:ss',
          displayFormats: { second: 'HH:mm:ss', minute: 'HH:mm', hour: 'HH:mm', day: 'd MMM' },
        },
        ticks: { color: theme.text, maxTicksLimit: 8, maxRotation: 0 },
        grid: { color: theme.grid },
      },
      y: {
        min: 0,
        ...(yMax === undefined ? {} : { max: yMax }),
        ticks: { color: theme.text, callback: (value) => formatY(Number(value)) },
        grid: { color: theme.grid },
        // Etiket uzunluğundan bağımsız sabit genişlik: grafikler birbirinin altında HİZALI durur.
        afterFit: (axis) => {
          axis.width = Y_AXIS_WIDTH
        },
      },
    },
    plugins: {
      legend: { display: showLegend, labels: { color: theme.text, boxWidth: 12 } },
      tooltip: {
        callbacks: { label: (ctx) => `${ctx.dataset.label ?? ''}: ${formatY(ctx.parsed.y ?? 0)}` },
      },
      decimation: { enabled: true, algorithm: 'lttb', samples: DECIMATION_SAMPLES },
    },
  }
}

/** Yarım daire gösterge (doughnut) verisi: dolu kısım eşiğe göre renklenir, kalanı "iz" rengindedir. */
export function buildGaugeData(percent: number, theme: ChartTheme): ChartData<'doughnut', number[]> {
  const value = clampPercent(percent)
  return {
    datasets: [
      {
        data: [value, 100 - value],
        backgroundColor: [theme[gaugeLevel(value)], theme.track],
        borderWidth: 0,
      },
    ],
  }
}

export const gaugeOptions: ChartOptions<'doughnut'> = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  rotation: -90, // yarım daire: soldan başlar
  circumference: 180,
  cutout: '72%',
  events: [], // gösterge etkileşimsiz: fare olaylarını dinleme
  plugins: { legend: { display: false }, tooltip: { enabled: false } },
}
