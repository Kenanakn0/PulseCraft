import { useMemo } from 'react'
import { useChartTheme } from '../charts/useChartTheme'
import { formatBytesRate } from '../metrics/format'
import { getRange, type RangeId } from '../metrics/ranges'
import { useNodeMetrics } from '../metrics/useNodeMetrics'
import { LineChart } from './LineChart'

const percentTick = (value: number) => `${value}%`

interface MetricsPanelProps {
  nodeId: string
  rangeId: RangeId
}

/**
 * Seçili aralığın geçmiş grafikleri. Üst bileşen bunu `key={`${nodeId}:${rangeId}`}` ile çizer:
 * sunucu ya da aralık değişince panel sıfırdan kurulur (yükleme durumu temiz başlar).
 */
export function MetricsPanel({ nodeId, rangeId }: MetricsPanelProps) {
  const { state, reload } = useNodeMetrics(nodeId, rangeId)
  const theme = useChartTheme()

  const points = state.status === 'ready' ? state.points : null
  const series = useMemo(() => {
    if (points === null) return null
    return {
      cpuMem: [
        { label: 'CPU', color: theme.cpu, data: points.map((p) => ({ x: p.t, y: p.cpu })) },
        { label: 'RAM', color: theme.mem, data: points.map((p) => ({ x: p.t, y: p.mem })) },
      ],
      network: [
        { label: 'İndirme', color: theme.rx, data: points.map((p) => ({ x: p.t, y: p.rx })) },
        { label: 'Gönderme', color: theme.tx, data: points.map((p) => ({ x: p.t, y: p.tx })) },
      ],
    }
  }, [points, theme])

  if (state.status === 'loading') {
    return (
      <p className="page-message" role="status">
        Ölçümler yükleniyor…
      </p>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="card error-card" role="alert">
        <p>{state.message}</p>
        <button type="button" onClick={reload}>
          Yeniden dene
        </button>
      </div>
    )
  }

  const range = getRange(rangeId)

  if (state.points.length === 0 || series === null) {
    return (
      <div className="card">
        <p>Bu aralıkta ölçüm yok.</p>
        {state.resolution === '1m' && (
          <p className="muted">
            Uzun aralıklar dakikalık özetten okunur; yeni ölçümler özete en geç birkaç dakika içinde yansır.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="metrics-panel">
      {state.refreshError !== null && (
        <p className="notice" role="status">
          {state.refreshError} Son bilinen veriler gösteriliyor.
        </p>
      )}

      <p className="muted chart-caption">
        {range.label} · {state.resolution === 'raw' ? 'ham ölçümler' : 'dakikalık ortalama'} · {state.points.length}{' '}
        nokta
      </p>

      <section className="card chart-card" aria-label="CPU ve RAM">
        <h2>CPU ve RAM</h2>
        <LineChart
          series={series.cpuMem}
          resolution={state.resolution}
          from={state.from}
          to={state.to}
          yMax={100}
          formatY={percentTick}
          ariaLabel="CPU ve RAM kullanımı (yüzde) zaman grafiği"
        />
      </section>

      <section className="card chart-card" aria-label="Ağ trafiği">
        <h2>Ağ trafiği</h2>
        <LineChart
          series={series.network}
          resolution={state.resolution}
          from={state.from}
          to={state.to}
          formatY={formatBytesRate}
          ariaLabel="Ağ indirme ve gönderme hızı zaman grafiği"
        />
      </section>
    </div>
  )
}
