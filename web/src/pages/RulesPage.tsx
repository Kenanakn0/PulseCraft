import { RuleForm } from '../components/RuleForm'
import { RuleRow } from '../components/RuleRow'
import { useNodes } from '../nodes/useNodes'
import { useRules } from '../rules/useRules'

/** Alarm kuralları ekranı: `/alert-rules`. Ekleme (RuleForm) + liste (etkinleştir/kapat/sil). */
export function RulesPage() {
  const { state, reload } = useRules()
  const { state: nodesState } = useNodes()
  const nodes = nodesState.status === 'ready' ? nodesState.nodes : []
  const nodeName = (id: string) => nodes.find((n) => n.id === id)?.name ?? null

  return (
    <section>
      <div className="page-head">
        <h1>Alarm kuralları</h1>
      </div>

      <RuleForm nodes={nodes} onCreated={reload} />

      {state.status === 'loading' && (
        <p className="page-message" role="status">
          Kurallar yükleniyor…
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
              {state.refreshError} Son bilinen liste gösteriliyor.
            </p>
          )}

          {state.rules.length === 0 ? (
            <p className="card">Henüz kural yok. Yukarıdan bir tane ekleyin.</p>
          ) : (
            <table className="rule-table">
              <thead>
                <tr>
                  <th>Ad</th>
                  <th>Koşul</th>
                  <th>Sunucu</th>
                  <th>Önem</th>
                  <th>Durum</th>
                  <th aria-label="İşlemler" />
                </tr>
              </thead>
              <tbody>
                {state.rules.map((rule) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    nodeName={rule.node_id === null ? null : nodeName(rule.node_id)}
                    onChanged={reload}
                  />
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  )
}
