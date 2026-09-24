import type { ConnectionStatus } from '../realtime/client'
import { useRealtime } from '../realtime/useRealtime'

const LABELS: Record<ConnectionStatus, string> = {
  connecting: 'Bağlanıyor…',
  open: 'Canlı',
  reconnecting: 'Yeniden bağlanıyor…',
  closed: 'Bağlantı yok',
}

/** Üst çubuktaki canlı bağlantı göstergesi. Bağlantı kopunca kullanıcı verinin artık akmadığını görür. */
export function LiveIndicator() {
  const { status } = useRealtime()

  return (
    <span className={`live-indicator live-${status}`} data-testid="live-status" role="status">
      <span className="live-dot" aria-hidden="true" />
      {LABELS[status]}
    </span>
  )
}
