import { Link } from 'react-router'
import type { NodeSummary } from '../api/types'
import { formatAge, formatPercent } from '../nodes/format'
import { StatusBadge } from './StatusBadge'

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

export function NodeCard({ node }: { node: NodeSummary }) {
  // Drop empty parts; a dash if neither hostname nor OS is known.
  const meta = [node.hostname, node.os].filter((part): part is string => part !== null && part !== '')

  return (
    <article className="card node-card" data-testid="node-card" data-online={node.online}>
      <header className="node-card-head">
        <h2 className="node-name">
          {/*
           * Only the title is a link (one meaningful link for screen readers); CSS ::after stretches the click
           * area over the whole card.
           */}
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
