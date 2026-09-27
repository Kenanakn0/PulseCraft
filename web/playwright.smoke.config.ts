import { defineConfig, devices } from '@playwright/test'

// SMOKE TEST: runs against the real stack served by docker compose (nginx + built React + server), not
// the Vite dev server. Unlike e2e/ it checks the built files, nginx headers (CSP, caching, gzip), SPA
// routing and the WebSocket through nginx.
//
//   Environment: SMOKE_BASE_URL (e.g. http://localhost:8080), E2E_EMAIL, E2E_PASSWORD
//   npm run smoke
//
// WARNING: it creates a node and posts samples. Run it against a throw-away stack with fake credentials.
export default defineConfig({
  testDir: './smoke',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: process.env.SMOKE_BASE_URL ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
