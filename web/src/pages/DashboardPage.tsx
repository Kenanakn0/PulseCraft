import { AddNodePanel } from '../components/AddNodePanel'
import { NodeCard } from '../components/NodeCard'
import { sortNodes } from '../nodes/format'
import { useNodes } from '../nodes/useNodes'

export function DashboardPage() {
  // Hook, bileşenin en üst düzeyinde çağrılır. Yükleme/yenileme mantığı bileşenden ayrı,
  // yeniden kullanılabilir bir yerde (useNodes) durur; bu bileşen yalnızca "ne çizeceğini" bilir.
  const { state, reload } = useNodes()

  return (
    <section>
      <div className="page-head">
        <h1>Sunucular</h1>
        {state.status === 'ready' && (
          <p className="muted" data-testid="node-summary">
            {state.nodes.length} sunucu · {state.nodes.filter((n) => n.online).length} çevrimiçi
          </p>
        )}
      </div>

      <div className="page-actions">
        <AddNodePanel onCreated={reload} />
      </div>

      {state.status === 'loading' && (
        <p className="page-message" role="status">
          Sunucular yükleniyor…
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

      {state.status === 'ready' && (
        <>
          {state.refreshError !== null && (
            <p className="notice" role="status">
              {state.refreshError} Son bilinen veriler gösteriliyor.
            </p>
          )}

          {state.nodes.length === 0 ? (
            <div className="card">
              <p>Henüz kayıtlı sunucu yok.</p>
              <p className="muted">
                Yukarıdaki <strong>Sunucu ekle</strong> ile bir sunucu oluşturup agent&apos;ı verilen API anahtarıyla
                çalıştırın.
              </p>
            </div>
          ) : (
            <div className="node-grid">
              {/* KEY: listedeki her öğeye kararlı, benzersiz bir kimlik verilir. React, liste
                  değişince (yeniden sıralama, ekleme, silme) hangi öğenin hangisi olduğunu bununla
                  anlar ve yalnızca gerçekten değişeni günceller. Blazor'daki @key ile aynıdır.
                  Dizinin sırasını (index) key yapma: sıra değişince kimlikler kayar. */}
              {sortNodes(state.nodes).map((node) => (
                <NodeCard key={node.id} node={node} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
