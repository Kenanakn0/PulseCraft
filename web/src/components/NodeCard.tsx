import type { NodeSummary } from '../api/types'
import { formatAge, formatPercent } from '../nodes/format'

// Bu dosyadaki küçük yardımcı bileşenler dışa aktarılmaz; yalnızca NodeCard dışarıya açık.

function StatusBadge({ online }: { online: boolean }) {
  return <span className={`badge ${online ? 'online' : 'offline'}`}>{online ? 'Çevrimiçi' : 'Çevrimdışı'}</span>
}

// PROPS: bileşene dışarıdan verilen, bileşenin DEĞİŞTİREMEDİĞİ girdiler (C#/Blazor'da [Parameter]).
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

/** Tek bir sunucunun özet kartı. */
export function NodeCard({ node }: { node: NodeSummary }) {
  // Boş/null parçaları ele: hostname ve OS'nin ikisi de yoksa tire göster.
  const meta = [node.hostname, node.os].filter((part): part is string => part !== null && part !== '')

  return (
    <article className="card node-card" data-testid="node-card" data-online={node.online}>
      <header className="node-card-head">
        <h2 className="node-name">{node.name}</h2>
        <StatusBadge online={node.online} />
      </header>

      <p className="muted node-meta">{meta.length > 0 ? meta.join(' · ') : '—'}</p>

      {node.latest === null ? (
        <p className="muted">Henüz ölçüm yok</p>
      ) : (
        <dl
          className={`node-metrics${node.online ? '' : ' stale'}`}
          title={node.online ? undefined : 'Sunucu çevrimdışı: bunlar son kaydedilen değerler'}
        >
          <Metric label="CPU" value={formatPercent(node.latest.cpu_percent)} />
          <Metric label="RAM" value={formatPercent(node.latest.mem_percent)} />
          <Metric label="Disk" value={formatPercent(node.latest.disk_percent)} />
        </dl>
      )}

      <p className="muted node-seen">Son görülme: {formatAge(node.last_seen_seconds_ago)}</p>
    </article>
  )
}
