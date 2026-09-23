import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Geliştirme sırasında API isteklerinin gideceği adres. Varsayılan: docker compose'daki
// nginx (127.0.0.1:8080). IPv4 adresi bilerek yazıldı: nginx yalnızca 127.0.0.1'e bağlı.
const apiTarget = process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:8080'

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    strictPort: true, // 5173 doluysa sessizce başka porta geçme (Playwright ve WS Origin kontrolü bu adrese güvenir)

    // Tarayıcı yalnızca Vite'ın adresini (http://localhost:5173) bilir: /api ve /ws
    // isteklerini Vite sunucuya yönlendirir. Böylece tarayıcı için TEK origin vardır:
    // cookie'ler gönderilir ve WebSocket Origin kontrolü geçer (prod'da bu işi nginx yapar).
    // changeOrigin bilerek KAPALI: Host başlığı (localhost:5173) olduğu gibi kalmalı,
    // yoksa server Origin ile Host'un uyuşmadığını görüp WS bağlantısını reddeder.
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
      '/ws': { target: apiTarget, changeOrigin: false, ws: true },
    },
  },

  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'], // e2e/ altındaki Playwright testlerini Vitest çalıştırmasın
  },
})
