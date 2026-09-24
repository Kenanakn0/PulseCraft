import { useMemo } from 'react'
import { Line } from 'react-chartjs-2'
import { buildLineData, buildLineOptions, type LineSeries } from '../charts/config'
import '../charts/register'
import { useChartTheme } from '../charts/useChartTheme'

interface LineChartProps {
  series: LineSeries[]
  resolution: 'raw' | '1m'
  /** x ekseni sınırları (ms). */
  from: number
  to: number
  yMax?: number
  formatY: (value: number) => string
  /** Ekran okuyucular için grafiğin kısa açıklaması (canvas'ın kendisi okunamaz). */
  ariaLabel: string
}

export function LineChart({ series, resolution, from, to, yMax, formatY, ariaLabel }: LineChartProps) {
  // Tema değişince (koyu/açık) grafik yeni renklerle yeniden çizilir.
  const theme = useChartTheme()

  // useMemo: seçenek/veri nesneleri yalnızca girdileri değişince yeniden üretilir. Her çizimde yeni bir
  // nesne verirsek react-chartjs-2 bunu "değişiklik" sayıp grafiği gereksiz güncellerdi.
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
