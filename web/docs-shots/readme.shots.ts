import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test'

// README ekran görüntüleri. UYDURMA veri: sunucu adları/hostname'ler hayalidir (web-01, db-01 …), metrikler
// tohumlu (deterministik) bir üreteçle çizilir. Kimseye ait gerçek ad, bilgisayar adı ya da anahtar görüntüye girmez.

const OUT = '../docs/screenshots'
const shot = (name: string) => `${OUT}/${name}.png`

const admin = { email: process.env.SHOTS_ADMIN_EMAIL, password: process.env.SHOTS_ADMIN_PASSWORD }
const ops = { email: process.env.SHOTS_OPS_EMAIL, password: process.env.SHOTS_OPS_PASSWORD }

// Tohumlu sözde rastgele sayı (her koşuda aynı eğriler).
function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

interface Profile {
  name: string
  hostname: string
  cpu: (i: number, n: number, r: () => number) => number
  mem: (i: number, n: number, r: () => number) => number
  disk: number
  /** Son örnek şimdiden kaç saniye önce (çevrimdışı görünmesi için > 15 sn). */
  endAgoSec: number
}

const N = 180 // 15 dk, 5 sn aralık
const STEP_MS = 5_000

const profiles: Profile[] = [
  {
    name: 'web-01',
    hostname: 'web-01.demo.internal',
    // Ortada ~3 dk süren bir CPU sıçraması: "Yüksek CPU" alarmı açılıp ÇÖZÜLÜR (çözülen sekmesi için).
    cpu: (i, _n, r) => (i > 70 && i < 110 ? 91 + r() * 6 : 38 + 12 * Math.sin(i / 9) + r() * 6),
    mem: (i, _n, r) => 58 + 4 * Math.sin(i / 25) + r() * 2,
    disk: 41.3,
    endAgoSec: 0,
  },
  {
    name: 'web-02',
    hostname: 'web-02.demo.internal',
    cpu: (i, _n, r) => 27 + 9 * Math.sin(i / 11 + 1) + r() * 5,
    mem: (i, _n, r) => 52 + 3 * Math.cos(i / 20) + r() * 2,
    disk: 38.7,
    endAgoSec: 0,
  },
  {
    name: 'db-01',
    hostname: 'db-01.demo.internal',
    // Son ~2 dk CPU yüksek: "Yüksek CPU" (kritik) AÇIK kalır. Disk sürekli %88: "Disk dolmak üzere" (uyarı).
    cpu: (i, n, r) => (i > n - 24 ? 90 + r() * 5 : 55 + 10 * Math.sin(i / 7) + r() * 5),
    mem: (i, _n, r) => 76 + 3 * Math.sin(i / 15) + r() * 2,
    disk: 88.4,
    endAgoSec: 0,
  },
  {
    name: 'cache-01',
    hostname: 'cache-01.demo.internal',
    cpu: (i, _n, r) => 12 + 4 * Math.sin(i / 6) + r() * 3,
    mem: (_i, _n, r) => 44 + r() * 2,
    disk: 22.1,
    endAgoSec: 240, // 4 dk önce sustu → çevrimdışı
  },
]

interface Seeded {
  id: string
  key: string
  profile: Profile
}

async function login(email: string, password: string) {
  const api = await request.newContext({ baseURL: test.info().project.use.baseURL })
  const res = await api.post('/api/v1/auth/login', { data: { email, password } })
  expect(res.ok(), `${email} ile giriş`).toBe(true)
  return api
}

function sample(p: Profile, i: number, at: number, r: () => number) {
  return {
    time: new Date(at).toISOString(),
    cpu_percent: Math.min(99, Math.max(1, p.cpu(i, N, r))),
    mem_percent: Math.min(99, Math.max(1, p.mem(i, N, r))),
    mem_used_bytes: Math.round(16 * 1024 ** 3 * (p.mem(i, N, r) / 100)),
    disk_percent: p.disk,
    net_rx_bps: Math.round(180_000 + 120_000 * Math.sin(i / 5) + r() * 40_000),
    net_tx_bps: Math.round(60_000 + 30_000 * Math.cos(i / 4) + r() * 15_000),
    load1: null,
  }
}

async function ingest(baseURL: string | undefined, key: string, hostname: string, samples: unknown[]) {
  const agent = await request.newContext({ baseURL })
  const res = await agent.post('/api/v1/metrics', {
    headers: { Authorization: `Bearer ${key}` },
    data: { hostname, samples },
  })
  expect(res.status(), 'ölçüm gönderme').toBe(202)
  await agent.dispose()
}

let seeded: Seeded[] = []
let adminState: Awaited<ReturnType<APIRequestContext['storageState']>>

test.describe.configure({ mode: 'serial' })

test.describe('README ekran görüntüleri', () => {
  test.skip(!admin.email || !admin.password || !ops.email || !ops.password, 'SHOTS_* kimlik bilgileri tanımlı değil')

  test.beforeAll(async ({ baseURL }) => {
    const api = await login(admin.email!, admin.password!)
    adminState = await api.storageState()

    // Boş bir prova yığını bekleniyor: yanlışlıkla gerçek veriye karşı çalışmayı engelle.
    const existing = (await (await api.get('/api/v1/nodes')).json()) as unknown[]
    expect(existing, 'README görüntüleri BOŞ bir prova yığınında üretilmeli').toHaveLength(0)

    // Kurallar ÖNCE: motor geçmiş örnekleri değerlendirirken kurallar hazır olsun.
    const rules = [
      { name: 'Yüksek CPU', node_id: null, metric: 'cpu_percent', operator: '>', threshold: 85, duration_seconds: 60, severity: 'critical', enabled: true },
      { name: 'Disk dolmak üzere', node_id: null, metric: 'disk_percent', operator: '>', threshold: 85, duration_seconds: 0, severity: 'warning', enabled: true },
      { name: 'Yüksek RAM', node_id: null, metric: 'mem_percent', operator: '>', threshold: 90, duration_seconds: 300, severity: 'warning', enabled: false },
    ]
    for (const rule of rules) expect((await api.post('/api/v1/alert-rules', { data: rule })).status()).toBe(201)

    const now = Date.now()
    seeded = []
    // Alarmın açılış/çözülüş zamanı SUNUCUNUN kayıt anıdır (örnek zamanı değil). web-01'in geçmişi tek istekte
    // gitse "Yüksek CPU" aynı anda açılıp çözülür ("Süre: 0 sn"); bu yüzden sıçramadan SONRAKİ kısmı bekleme
    // sonunda gönderilir → çözülen alarm gerçek bir süre gösterir.
    let deferred: (() => Promise<void>) | undefined
    for (const [idx, p] of profiles.entries()) {
      const created = await api.post('/api/v1/nodes', { data: { name: p.name } })
      const { id, api_key: key } = (await created.json()) as { id: string; api_key: string }
      const r = rng(idx + 7)
      const end = now - p.endAgoSec * 1000
      const history = Array.from({ length: N }, (_, i) => sample(p, i, end - (N - 1 - i) * STEP_MS, r))
      if (p.name === 'web-01') {
        await ingest(baseURL, key, p.hostname, history.slice(0, 110))
        deferred = () => ingest(baseURL, key, p.hostname, history.slice(110))
      } else {
        await ingest(baseURL, key, p.hostname, history)
      }
      seeded.push({ id, key, profile: p })
    }

    // Disk uyarısını "Operatör" incelemeye alır (ikinci kullanıcı).
    const opsApi = await login(ops.email!, ops.password!)
    const open = (await (await opsApi.get('/api/v1/alerts?status=open')).json()) as { id: number; rule_name: string }[]
    const disk = open.find((a) => a.rule_name === 'Disk dolmak üzere')
    expect(disk, 'disk alarmı açılmış olmalı').toBeDefined()
    expect((await opsApi.post(`/api/v1/alerts/${disk!.id}/ack`)).status()).toBe(200)
    await opsApi.dispose()
    await api.dispose()

    // "Son görülme" SUNUCU saatiyle, isteğin geldiği an yazılır (örneğin zaman damgasıyla değil). cache-01'in
    // çevrimdışı görünmesi için 15 sn eşiğini beklemek gerekir; diğerleri her görüntüden önce nabız gönderir.
    await new Promise((resolve) => setTimeout(resolve, 17_000))
    await deferred!() // web-01 normale döner → "Yüksek CPU" çözülür
  })

  /** Çevrimiçi sunuculara "şimdi" zamanlı birer örnek (15 sn eşiği içinde kalsınlar). */
  async function heartbeat(baseURL: string | undefined) {
    for (const s of seeded) {
      if (s.profile.endAgoSec > 0) continue
      await ingest(baseURL, s.key, s.profile.hostname, [sample(s.profile, N - 1, Date.now(), rng(99))])
    }
  }

  async function open(page: Page, baseURL: string | undefined, path: string) {
    await heartbeat(baseURL)
    await page.goto(path)
    await expect(page.getByTestId('live-status')).toHaveText('Canlı')
  }

  test('sunucu listesi', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ storageState: adminState })
    const page = await context.newPage()
    await open(page, baseURL, '/')
    await expect(page.getByTestId('node-card')).toHaveCount(4)
    await expect(page.getByTestId('node-summary')).toHaveText('4 sunucu · 3 çevrimiçi')
    await page.screenshot({ path: shot('dashboard') })
    await context.close()
  })

  test('sunucu detayı (açık ve koyu tema)', async ({ browser, baseURL }) => {
    const db = seeded.find((s) => s.profile.name === 'db-01')!
    for (const [scheme, name] of [['light', 'node-detail'], ['dark', 'node-detail-dark']] as const) {
      const context = await browser.newContext({ storageState: adminState, colorScheme: scheme })
      const page = await context.newPage()
      await open(page, baseURL, `/nodes/${db.id}`)
      await expect(page.getByText(/ham ölçümler/)).toBeVisible()
      await expect(page.locator('.chart-box canvas')).toHaveCount(2)
      await page.waitForTimeout(300) // canvas çizimi
      // "Sunucuyu sil" bölümü görüntüye girmesin: grafiklerin sonuna kadar kırp.
      const box = await page.locator('.metrics-panel').boundingBox()
      await page.screenshot({ path: shot(name), clip: { x: 0, y: 0, width: 1280, height: Math.ceil(box!.y + box!.height + 24) }, fullPage: true })
      await context.close()
    }
  })

  test('alarm panosu', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ storageState: adminState })
    const page = await context.newPage()
    await open(page, baseURL, '/alerts')
    await expect(page.getByTestId('alert-card')).toHaveCount(1) // açık: db-01 Yüksek CPU
    await page.screenshot({ path: shot('alerts-open') })

    await page.getByRole('tab', { name: /İncelenen/ }).click()
    await expect(page.getByTestId('alert-card')).toContainText('Operatör')
    await page.screenshot({ path: shot('alerts-acknowledged') })

    await page.getByRole('tab', { name: /Çözülen/ }).click()
    await expect(page.getByTestId('alert-card')).toContainText('Süre:')
    await page.screenshot({ path: shot('alerts-resolved') })
    await context.close()
  })

  test('alarm kuralları', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ storageState: adminState })
    const page = await context.newPage()
    await open(page, baseURL, '/alert-rules')
    await expect(page.getByTestId('rule-row')).toHaveCount(3)
    await page.screenshot({ path: shot('rules') })
    await context.close()
  })
})
