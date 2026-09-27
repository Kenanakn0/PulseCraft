import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { DeleteNodeSection } from '../components/DeleteNodeSection'
import { Gauge } from '../components/Gauge'
import { MetricsPanel } from '../components/MetricsPanel'
import { RangeSelector } from '../components/RangeSelector'
import { StatusBadge } from '../components/StatusBadge'
import { parseRangeId, type RangeId } from '../metrics/ranges'
import { formatAge } from '../nodes/format'
import { useNodes } from '../nodes/useNodes'

// Default export so the page can be loaded with React.lazy.
export default function NodeDetailPage() {
  const { id = '' } = useParams()

  // The range lives in the URL (?range=), so a reload or a shared link shows the same view.
  const [searchParams, setSearchParams] = useSearchParams()
  const rangeId = parseRangeId(searchParams.get('range'))
  const changeRange = (next: RangeId) => setSearchParams({ range: next }, { replace: true })

  // Server info (name, online status, latest values) comes from the list endpoint and refreshes periodically.
  const { state, reload } = useNodes()
  const navigate = useNavigate()
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

          {/*
           * After deleting, go back to the list; `replace` so Back does not return to a page that no longer exists.
           */}
          <DeleteNodeSection node={node} onDeleted={() => navigate('/', { replace: true })} />
        </>
      )}
    </section>
  )
}
