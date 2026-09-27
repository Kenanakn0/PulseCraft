import { useMemo } from 'react'
import { Line } from 'react-chartjs-2'
import { buildLineData, buildLineOptions, type LineSeries } from '../charts/config'
import '../charts/register'
import { useChartTheme } from '../charts/useChartTheme'

interface LineChartProps {
  series: LineSeries[]
  resolution: 'raw' | '1m'
  from: number
  to: number
  yMax?: number
  formatY: (value: number) => string
  /** Short description for screen readers (the canvas itself is not readable). */
  ariaLabel: string
}

export function LineChart({ series, resolution, from, to, yMax, formatY, ariaLabel }: LineChartProps) {
  const theme = useChartTheme()

  // Memoized: a new options/data object on every render would make react-chartjs-2 update the chart needlessly.
  const data = useMemo(() => buildLineData(series, resolution), [series, resolution])
  const options = useMemo(
    () => buildLineOptions({ from, to, theme, yMax, formatY, showLegend: series.length > 1 }),
    [from, to, theme, yMax, formatY, series.length],
  )

  return (
    <div className="chart-box" role="img" aria-label={ariaLabel}>
      <Line data={data} options={options} />
    </div>
  )
}
