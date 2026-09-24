import { Link, useParams, useSearchParams } from 'react-router'
import { Gauge } from '../components/Gauge'
import { MetricsPanel } from '../components/MetricsPanel'
import { RangeSelector } from '../components/RangeSelector'
import { StatusBadge } from '../components/StatusBadge'
import { parseRangeId, type RangeId } from '../metrics/ranges'
import { formatAge } from '../nodes/format'
import { useNodes } from '../nodes/useNodes'

// `React.lazy` ile yüklenebilsin diye bu sayfa varsayılan (default) dışa aktarılır.
export default function NodeDetailPage() {
  // useParams: adres çubuğundaki /nodes/:id parçasını okur (C#'ta route parametresi, [FromRoute] id).
  const { id = '' } = useParams()

  // useSearchParams: ?range=1h gibi sorgu dizesini okur/yazar (C#'ta [FromQuery]). Aralığı adreste
  // tutmak, sayfa yenilenince ya da bağlantı paylaşılınca aynı görünümün gelmesini sağlar.
  const [searchParams, setSearchParams] = useSearchParams()
  const rangeId = parseRangeId(searchParams.get('range'))
  const changeRange = (next: RangeId) => setSearchParams({ range: next }, { replace: true })

  // Sunucu bilgisi (ad, çevrimiçi durumu, son değerler) liste uç noktasından gelir ve periyodik yenilenir.
  const { state, reload } = useNodes()
  const node = state.status === 'ready' ? (state.nodes.find((n) => n.id === id) ?? null) : null

  return (
    <section>
      <p>
        <Link to="/">← Sunucular</Link>
      </p>

      {state.status === 'loading' && (
        <p className="page-message" role="status">
          Sunucu yükleniyor…
        </p>
      )}

      {state.status === 'error' && (
        <div className="card error-card" role="alert">
          <p>{state.message}</p>
          <button type="button" onClick={reload}>
            Yeniden dene
          </button>
        </div>
      )}

      {state.status === 'ready' && node === null && (
        <div className="card" role="alert">
          <p>Bu sunucu bulunamadı.</p>
          <p className="muted">Silinmiş olabilir ya da adres hatalı.</p>
        </div>
      )}

      {node !== null && (
        <>
          <div className="page-head detail-head">
            <h1>{node.name}</h1>
            <StatusBadge online={node.online} />
            <p className="muted">
              {[node.hostname, node.os].filter((p): p is string => p !== null && p !== '').join(' · ') || '—'}
              {' · '}Son görülme: {formatAge(node.last_seen_seconds_ago)}
            </p>
          </div>

          <div className={`gauge-row${node.online ? '' : ' stale'}`}>
            <Gauge label="CPU" value={node.latest?.cpu_percent ?? null} />
            <Gauge label="RAM" value={node.latest?.mem_percent ?? null} />
            <Gauge label="Disk" value={node.latest?.disk_percent ?? null} />
          </div>

          <div className="detail-toolbar">
            <h2>Geçmiş</h2>
            <RangeSelector value={rangeId} onChange={changeRange} />
          </div>

          <MetricsPanel key={`${id}:${rangeId}`} nodeId={id} rangeId={rangeId} />
        </>
      )}
    </section>
  )
}
