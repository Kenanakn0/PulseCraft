import { defineConfig, devices } from '@playwright/test'

// README SCREENSHOTS (a document generator, not a test). Runs against the built app (nginx) with
// FICTIONAL data and writes the images to ../docs/screenshots/ (committed on purpose).
//
//   Environment: SHOTS_BASE_URL (default http://127.0.0.1:18080), SHOTS_ADMIN_EMAIL/SHOTS_ADMIN_PASSWORD
//   (a throw-away user displayed as "Admin"), SHOTS_OPS_EMAIL/SHOTS_OPS_PASSWORD (displayed as "Operatör").
//   Do not type passwords on the command line; use only the throw-away stack's fake credentials.
//   npm run docs:shots
//
// WARNING: it CREATES servers, rules and alerts. Run it only against an empty throw-away stack with fake
// credentials; against real data it pollutes your data and real names end up in the images.
export default defineConfig({
  testDir: './docs-shots',
  testMatch: /.*\.shots\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: process.env.SHOTS_BASE_URL ?? 'http://127.0.0.1:18080',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
})
