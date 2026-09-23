// jest-dom: toBeInTheDocument, toHaveTextContent gibi DOM eşleştiricilerini Vitest'e ekler.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Her testten sonra: ekrandaki bileşenleri kaldır (unmount → effect cleanup'ları çalışır),
// sahte fetch'i geri al. (Vitest'te `globals` kapalı olduğu için Testing Library bunu kendiliğinden yapmaz.)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
