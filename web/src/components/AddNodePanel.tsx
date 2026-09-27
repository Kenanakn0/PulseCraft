import { useState, type SubmitEvent } from 'react'
import { ApiError } from '../api/http'
import { nodesApi } from '../api/nodes'
import type { CreatedNode } from '../api/types'
import { validateNodeName } from '../nodes/form'

interface AddNodePanelProps {
  /** Sunucu oluşturulunca (anahtar gösterilirken) listeyi yenilemek için. */
  onCreated: () => void
  /** Yeni sunucunun agent'ı bağlandı mı (liste + canlı akıştan). Panelde "bekleniyor / bağlandı" gösterilir. */
  isOnline?: (nodeId: string) => boolean
}

type CopyState = 'idle' | 'copied' | 'failed'

/**
 * "Sunucu ekle": ad alır, sunucuyu oluşturur ve agent'ın API anahtarını YALNIZCA BİR KEZ gösterir.
 * Sunucu anahtarın yalnızca hash'ini saklar; bu panel kapanınca anahtar tarayıcı belleğinden de silinir.
 */
export function AddNodePanel({ onCreated, isOnline = () => false }: AddNodePanelProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedNode | null>(null)
  const [copy, setCopy] = useState<CopyState>('idle')

  function close() {
    // Anahtar state'ten silinir: panel bir daha açılsa da görünmez.
    setOpen(false)
    setName('')
    setError(null)
    setCreated(null)
    setCopy('idle')
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const validationError = validateNodeName(name)
    if (validationError !== null) {
      setError(validationError)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      setCreated(await nodesApi.create(name.trim()))
      onCreated()
    } catch (err) {
      setError(err instanceof ApiError && err.status !== 0 ? err.message : 'Sunucuya ulaşılamadı.')
    } finally {
      setSubmitting(false)
    }
  }

  async function copyKey(key: string) {
    try {
      // Pano API'si yalnızca güvenli bağlamda (https ya da localhost) vardır.
      await navigator.clipboard.writeText(key)
      setCopy('copied')
    } catch {
      setCopy('failed')
    }
  }

  if (!open) {
    return (
      <button type="button" className="primary" onClick={() => setOpen(true)}>
        Sunucu ekle
      </button>
    )
  }

  if (created !== null) {
    return (
      <section className="card key-reveal" aria-label="Yeni sunucunun API anahtarı">
        <h2>“{created.name}” eklendi</h2>
        <p className="notice" role="status">
          Bu API anahtarı <strong>yalnızca şimdi</strong> gösteriliyor; sunucu yalnızca özetini (hash) saklar.
          Kaybederseniz sunucuyu silip yeniden eklemeniz gerekir.
        </p>

        <label htmlFor="new-node-key">API anahtarı</label>
        <div className="key-row">
          <input id="new-node-key" className="mono" readOnly value={created.api_key} onFocus={(e) => e.target.select()} />
          <button type="button" onClick={() => void copyKey(created.api_key)}>
            Kopyala
          </button>
        </div>
        {copy === 'copied' && <p className="muted">Panoya kopyalandı.</p>}
        {copy === 'failed' && (
          <p className="error" role="alert">
            Kopyalanamadı. Anahtarı seçip Ctrl+C ile kopyalayın.
          </p>
        )}

        <p className="muted">
          <strong>1.</strong> Agent&apos;ı başlatın (PowerShell, depo kök klasöründe <code>pulsecraft</code>):
        </p>
        <pre className="mono command">{`go -C agent run ./cmd/agent "-server=${window.location.origin}"`}</pre>
        <p className="muted">
          <strong>2.</strong> Agent anahtarı sorduğunda yukarıdaki <strong>Kopyala</strong>&apos;ya basın, terminale
          yapıştırın (sağ tık ya da Ctrl+V; yazdıklarınız ekranda <em>görünmez</em>) ve Enter&apos;a basın. Anahtar hiçbir
          komuta yazılmaz, komut geçmişine de girmez.
        </p>

        {isOnline(created.id) ? (
          <p className="agent-status connected" role="status" data-testid="agent-status">
            ✓ Agent bağlandı, ölçümler geliyor.
          </p>
        ) : (
          <p className="agent-status waiting" role="status" data-testid="agent-status">
            Agent bekleniyor… Bağlanana kadar bu paneli kapatmayın.
          </p>
        )}

        <button type="button" className="primary" onClick={close}>
          Tamam, anahtarı kaydettim
        </button>
      </section>
    )
  }

  return (
    <form className="card add-node" onSubmit={(e) => void handleSubmit(e)} noValidate aria-label="Sunucu ekle">
      <h2>Sunucu ekle</h2>
      <label htmlFor="new-node-name">Sunucu adı</label>
      <input
        id="new-node-name"
        placeholder="ör. web-01"
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={submitting}
        autoFocus
      />
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? 'Ekleniyor…' : 'Ekle'}
        </button>
        <button type="button" onClick={close} disabled={submitting}>
          Vazgeç
        </button>
      </div>
    </form>
  )
}
