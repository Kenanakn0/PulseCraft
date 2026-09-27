import { defineConfig, devices } from '@playwright/test'

// Browser (Chromium) tests. Before running:
//   1) the backend must be up (docker compose, or a throw-away stack with fake credentials);
//   2) E2E_EMAIL, E2E_PASSWORD (a user that can log in), for the two-user tests E2E_EMAIL2 and
//      E2E_PASSWORD2, and optionally VITE_PROXY_TARGET (backend address, default http://127.0.0.1:8080).
// Tests without credentials are skipped. The "setup" project (e2e/auth.setup.ts) logs each user in once;
// tests read the cookie from e2e/.auth/ (login is rate limited to 10 per minute per IP).
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1, // login is limited to 10 attempts per minute per IP; run tests one at a time
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },

  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, dependencies: ['setup'] },
  ],

  // Starts the Vite dev server (or reuses a running one).
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
