// jest-dom: toBeInTheDocument, toHaveTextContent gibi DOM eşleştiricilerini Vitest'e ekler.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { FakeSocket } from './fakeWebSocket'

// Her testte WebSocket sahtedir: jsdom'un gerçek soketi ağa çıkmaya çalışıp testleri kararsızlaştırırdı.
// Canlı akış testleri `FakeSocket.last` ile olayları elle tetikler.
beforeEach(() => {
  FakeSocket.reset()
  vi.stubGlobal('WebSocket', FakeSocket)
})

// Her testten sonra: ekrandaki bileşenleri kaldır (unmount → effect cleanup'ları çalışır),
// sahte fetch'i geri al. (Vitest'te `globals` kapalı olduğu için Testing Library bunu kendiliğinden yapmaz.)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
