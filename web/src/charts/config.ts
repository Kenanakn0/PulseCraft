import type { ChartData, ChartOptions } from 'chart.js'
import { tr } from 'date-fns/locale/tr'
import { clampPercent, gaugeLevel } from '../metrics/format'
import type { ChartTheme } from './theme'

export interface LineSeries {
  label: string
  color: string
  /** Sorted points; x = time (ms), y = value. */
  data: { x: number; y: number }[]
}

/** Target point count for Chart.js decimation (LTTB). */
export const DECIMATION_SAMPLES = 300

/**
 * Two points further apart than this are NOT joined by a line, so an outage shows as a gap instead of a
 * misleading flat line.
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
      pointRadius: 0, // no marker per point (slow and cluttered with thousands of points)
      pointHoverRadius: 3,
      spanGaps: gapThresholdMs(resolution),
    })),
  }
}

interface LineOptionsInput {
  /** x-axis bounds (ms): the window returned by the SERVER. */
  from: number
  to: number
  theme: ChartTheme
  /** y-axis maximum; automatic when omitted (the minimum is always 0). */
  yMax?: number
  formatY: (value: number) => string
  showLegend: boolean
}

/**
 * FIXED y-axis width (px). Chart.js sizes the axis by its label length ("100%" vs "341,8 KB/s"), which
 * misaligned the plot areas of the stacked charts. The longest label ("1.023,9 MB/s") fits.
 */
export const Y_AXIS_WIDTH = 84

/**
 * Options for live-updating charts: no animation on updates; `parsing: false` + `normalized: true`
 * because the data is already sorted {x, y}; LTTB decimation down to ~DECIMATION_SAMPLES points.
 */
export function buildLineOptions({ from, to, theme, yMax, formatY, showLegend }: LineOptionsInput): ChartOptions<'line'> {
  return {
    responsive: true,
    maintainAspectRatio: false, // height comes from the container (CSS)
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
        // Fixed width regardless of label length keeps stacked charts aligned.
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

/** Half-doughnut gauge data: the filled part is coloured by threshold, the rest uses the track colour. */
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
  rotation: -90, // half circle starting on the left
  circumference: 180,
  cutout: '72%',
  events: [], // gauge is not interactive: ignore mouse events
  plugins: { legend: { display: false }, tooltip: { enabled: false } },
}
