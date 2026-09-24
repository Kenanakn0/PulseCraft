import { Link } from 'react-router'
import type { NodeSummary } from '../api/types'
import { formatAge, formatPercent } from '../nodes/format'
import { StatusBadge } from './StatusBadge'

// PROPS: bileşene dışarıdan verilen, bileşenin DEĞİŞTİREMEDİĞİ girdiler (C#/Blazor'da [Parameter]).
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

/** Tek bir sunucunun özet kartı; tıklayınca detay sayfasına gider. */
export function NodeCard({ node }: { node: NodeSummary }) {
  // Boş/null parçaları ele: hostname ve OS'nin ikisi de yoksa tire göster.
  const meta = [node.hostname, node.os].filter((part): part is string => part !== null && part !== '')

  return (
    <article className="card node-card" data-testid="node-card" data-online={node.online}>
      <header className="node-card-head">
        <h2 className="node-name">
          {/* Bağlantı yalnızca başlıkta (ekran okuyucular için tek, anlamlı bir bağlantı); CSS'teki
              ::after ile tıklama alanı tüm karta yayılır. */}
          <Link to={`/nodes/${encodeURIComponent(node.id)}`} className="node-link">
            {node.name}
          </Link>
        </h2>
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
