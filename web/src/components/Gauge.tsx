import { useMemo } from 'react'
import { Doughnut } from 'react-chartjs-2'
import { buildGaugeData, gaugeOptions } from '../charts/config'
import '../charts/register'
import { useChartTheme } from '../charts/useChartTheme'
import { clampPercent, gaugeLevel } from '../metrics/format'
import { formatPercent } from '../nodes/format'

interface GaugeProps {
  label: string
  /** Yüzde (0-100). Değer yoksa (ölçüm yok) `null`: gösterge boş ve "—" gösterilir. */
  value: number | null
}

/** Yarım daire gösterge: CPU/RAM/Disk gibi bir yüzdeyi tek bakışta gösterir. */
export function Gauge({ label, value }: GaugeProps) {
  const theme = useChartTheme()
  const data = useMemo(() => buildGaugeData(value ?? 0, theme), [value, theme])

  const text = value === null ? '—' : formatPercent(value)
  const level = value === null ? 'none' : gaugeLevel(clampPercent(value))

  return (
    <figure className={`gauge gauge-${level}`} data-testid={`gauge-${label}`}>
      <div className="gauge-canvas" role="img" aria-label={`${label}: ${text}`}>
        <Doughnut data={data} options={gaugeOptions} />
        {/* Ortadaki değer canvas'ın DIŞINDA, sıradan HTML: metin keskin çizilir ve ekran okuyucuya açıktır. */}
        <span className="gauge-value">{text}</span>
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  )
}
