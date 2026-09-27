import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { FakeSocket } from './fakeWebSocket'

// WebSocket is always fake in tests: jsdom's real socket would try the network and make tests flaky.
// Live stream tests trigger events through `FakeSocket.last`.
beforeEach(() => {
  FakeSocket.reset()
  vi.stubGlobal('WebSocket', FakeSocket)
})

// After each test: unmount (runs effect cleanups) and restore fetch. With Vitest `globals` off, Testing
// Library does not do this by itself.
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
