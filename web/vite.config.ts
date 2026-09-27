import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Where API requests go during development. Default: nginx from docker compose (127.0.0.1:8080); the
// IPv4 address is deliberate because nginx is bound to 127.0.0.1 only.
const apiTarget = process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:8080'

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    strictPort: true, // do not silently move to another port if 5173 is taken (Playwright and the WS Origin check rely on it)

    // The browser only knows Vite's address (http://localhost:5173); Vite forwards /api and /ws to the backend.
    // The browser thus sees a single origin: cookies are sent and the WebSocket Origin check passes (nginx does
    // this in production). changeOrigin stays OFF: the Host header (localhost:5173) must be kept, otherwise the
    // server sees Origin and Host differ and rejects the WebSocket.
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
      '/ws': { target: apiTarget, changeOrigin: false, ws: true },
    },
  },

  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'], // keep Vitest away from the Playwright tests in e2e/
  },
})
