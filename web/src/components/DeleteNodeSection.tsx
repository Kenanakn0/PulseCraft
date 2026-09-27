import { useState } from 'react'
import { ApiError } from '../api/http'
import { nodesApi } from '../api/nodes'

interface DeleteNodeSectionProps {
  node: { id: string; name: string }
  onDeleted: () => void
}

/**
 * Sunucu detayının altındaki "tehlikeli bölge". Silme GERİ ALINAMAZ ve çok şey götürür (tüm metrikler, alarm
 * geçmişi, yalnızca bu sunucuya ait kurallar, agent anahtarı); bu yüzden kural silmedeki iki aşamalı onaydan
 * daha güçlü bir onay istenir: sunucunun adını yazmak (GitHub'ın depo silme onayı gibi).
 */
export function DeleteNodeSection({ node, onDeleted }: DeleteNodeSectionProps) {
  const [confirming, setConfirming] = useState(false)
  const [typed, setTyped] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function cancel() {
    setConfirming(false)
    setTyped('')
    setError(null)
  }

  async function remove() {
    setPending(true)
    setError(null)
    try {
      await nodesApi.remove(node.id)
      onDeleted()
    } catch (err) {
      setError(err instanceof ApiError && err.status !== 0 ? err.message : 'Sunucuya ulaşılamadı.')
      setPending(false)
    }
  }

  return (
    <section className="card danger-zone" aria-label="Sunucuyu sil">
      <h2>Sunucuyu sil</h2>
      {!confirming ? (
        <>
          <p className="muted">
            Sunucu, tüm ölçümleri, alarm geçmişi ve yalnızca bu sunucuya ait kurallar kalıcı olarak silinir; agent&apos;ın
            API anahtarı geçersiz olur.
          </p>
          <button type="button" className="danger" onClick={() => setConfirming(true)}>
            Sunucuyu sil…
          </button>
        </>
      ) : (
        <>
          <p>
            Bu işlem <strong>geri alınamaz</strong>. Onaylamak için sunucunun adını yazın: <code>{node.name}</code>
          </p>
          <label htmlFor="confirm-node-name">Sunucu adı</label>
          <input
            id="confirm-node-name"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={pending}
            autoComplete="off"
            autoFocus
          />
          {error !== null && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button type="button" className="danger" onClick={() => void remove()} disabled={pending || typed !== node.name}>
              {pending ? 'Siliniyor…' : 'Kalıcı olarak sil'}
            </button>
            <button type="button" onClick={cancel} disabled={pending}>
              Vazgeç
            </button>
          </div>
        </>
      )}
    </section>
  )
}
