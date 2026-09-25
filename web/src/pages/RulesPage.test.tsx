import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { jsonResponse, stubFetch, textResponse } from '../test/fetchStub'
import { makeNode, makeRule } from '../test/fixtures'
import { RulesPage } from './RulesPage'

const renderPage = () => render(<RulesPage />)

const rulesRoutes = (getRules: () => ReturnType<typeof makeRule>[]) => ({
  'GET /api/v1/alert-rules': () => jsonResponse(getRules()),
  'GET /api/v1/nodes': () => jsonResponse([makeNode({ id: 'n1', name: 'web-01' }), makeNode({ id: 'n2', name: 'db-01' })]),
})

/** Adına göre kural satırını bulur. */
const ruleRow = (name: string) => screen.getAllByTestId('rule-row').find((r) => within(r).queryByText(name) !== null)!

describe('RulesPage', () => {
  it('yüklenirken bilgi gösterir', async () => {
    stubFetch({
      'GET /api/v1/alert-rules': () => new Promise<Response>(() => undefined),
      'GET /api/v1/nodes': () => jsonResponse([]),
    })
    renderPage()
    expect(await screen.findByText('Kurallar yükleniyor…')).toBeInTheDocument()
  })

  it('kural listesini tabloda gösterir: koşul, sunucu, önem, durum', async () => {
    stubFetch(
      rulesRoutes(() => [
        makeRule({ id: 1, name: 'Yüksek CPU', node_id: null, threshold: 90 }),
        makeRule({ id: 2, name: 'Disk dolu', metric: 'disk_percent', threshold: 85, duration_seconds: 60, node_id: 'n1', severity: 'warning', enabled: false }),
      ]),
    )
    renderPage()

    const rows = await screen.findAllByTestId('rule-row')
    expect(rows).toHaveLength(2)

    const cpuRow = ruleRow('Yüksek CPU')
    expect(cpuRow).toHaveTextContent('CPU > 90 %')
    expect(cpuRow).toHaveTextContent('Tüm sunucular')
    expect(cpuRow).toHaveTextContent('Kritik')
    expect(within(cpuRow).getByText('Etkin')).toBeInTheDocument()
    expect(within(cpuRow).getByRole('button', { name: 'Devre dışı bırak' })).toBeInTheDocument()

    const diskRow = ruleRow('Disk dolu')
    expect(diskRow).toHaveTextContent('Disk > 85 % (60 sn boyunca)')
    expect(diskRow).toHaveTextContent('web-01')
    expect(within(diskRow).getByText('Kapalı')).toBeInTheDocument()
    expect(within(diskRow).getByRole('button', { name: 'Etkinleştir' })).toBeInTheDocument()
  })

  it('boş listede açıklayıcı mesaj gösterir', async () => {
    stubFetch(rulesRoutes(() => []))
    renderPage()
    expect(await screen.findByText('Henüz kural yok. Yukarıdan bir tane ekleyin.')).toBeInTheDocument()
  })

  it('node listesi henüz yokken de sunucu seçici çalışır (yalnızca "Tüm sunucular")', async () => {
    stubFetch({ 'GET /api/v1/alert-rules': () => jsonResponse([]), 'GET /api/v1/nodes': () => new Promise<Response>(() => undefined) })
    renderPage()
    await screen.findByText('Henüz kural yok. Yukarıdan bir tane ekleyin.')

    const select = screen.getByLabelText('Sunucu') as HTMLSelectElement
    expect([...select.options].map((o) => o.text)).toEqual(['Tüm sunucular'])
  })

  it('form: doğrulama hatası sunucuya istek göndermeden gösterilir', async () => {
    const { calls } = stubFetch(rulesRoutes(() => []))
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Henüz kural yok. Yukarıdan bir tane ekleyin.')

    await user.click(screen.getByRole('button', { name: 'Kural ekle' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Kural adı zorunlu.')
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('form: başarılı ekleme sonrası temizlenir ve liste yenilenir', async () => {
    let rules: ReturnType<typeof makeRule>[] = []
    const { calls } = stubFetch({
      ...rulesRoutes(() => rules),
      'POST /api/v1/alert-rules': (req) => {
        const created = makeRule({ id: 2, name: (req.body as { name: string }).name, node_id: (req.body as { node_id: string | null }).node_id })
        rules = [created]
        return jsonResponse(created, 201)
      },
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Henüz kural yok. Yukarıdan bir tane ekleyin.')

    await user.type(screen.getByLabelText('Ad'), 'Yeni kural')
    await user.selectOptions(screen.getByLabelText('Sunucu'), 'web-01')
    await user.type(screen.getByLabelText('Eşik (%)'), '80')
    await user.click(screen.getByRole('button', { name: 'Kural ekle' }))

    await waitFor(() => expect(screen.getByLabelText('Ad')).toHaveValue(''))
    expect(await screen.findByTestId('rule-row')).toHaveTextContent('Yeni kural')
    const post = calls.find((c) => c.method === 'POST')
    expect(post?.body).toMatchObject({ name: 'Yeni kural', node_id: 'n1', threshold: 80 })
  })

  it('form: sunucu hatasında (400) mesaj gösterilir, form silinmez', async () => {
    stubFetch({ ...rulesRoutes(() => []), 'POST /api/v1/alert-rules': () => textResponse('operator geçersiz', 400) })
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Henüz kural yok. Yukarıdan bir tane ekleyin.')

    await user.type(screen.getByLabelText('Ad'), 'Yeni kural')
    await user.type(screen.getByLabelText('Eşik (%)'), '80')
    await user.click(screen.getByRole('button', { name: 'Kural ekle' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('operator geçersiz')
    expect(screen.getByLabelText('Ad')).toHaveValue('Yeni kural')
  })

  it('devre dışı bırakma: TAM gövdeyi gönderir (yalnızca enabled değişir) ve liste yenilenir', async () => {
    let rule = makeRule({ id: 1, name: 'Yüksek CPU', node_id: 'n1', duration_seconds: 30, enabled: true })
    const { calls } = stubFetch({
      ...rulesRoutes(() => [rule]),
      'PUT /api/v1/alert-rules/1': (req) => {
        rule = { ...rule, ...(req.body as object), enabled: (req.body as { enabled: boolean }).enabled }
        return jsonResponse(rule)
      },
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Devre dışı bırak' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Etkinleştir' })).toBeInTheDocument())
    const put = calls.find((c) => c.method === 'PUT')
    expect(put?.body).toEqual({
      name: 'Yüksek CPU',
      node_id: 'n1',
      metric: 'cpu_percent',
      operator: '>',
      threshold: 90,
      duration_seconds: 30,
      severity: 'critical',
      enabled: false,
    })
  })

  it('silme: onay ister; "Vazgeç" siler(!), "Evet, sil" listeden kaldırır', async () => {
    let rules = [makeRule({ id: 1, name: 'Silinecek' })]
    const { calls } = stubFetch({
      ...rulesRoutes(() => rules),
      'DELETE /api/v1/alert-rules/1': () => {
        rules = []
        return jsonResponse(undefined, 204)
      },
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByTestId('rule-row')

    await user.click(screen.getByRole('button', { name: 'Sil' }))
    expect(screen.getByText(/Geçmiş alarmlar da silinir/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Vazgeç' }))
    expect(screen.queryByText(/Geçmiş alarmlar da silinir/)).not.toBeInTheDocument()
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false) // vazgeçmek silmedi

    await user.click(screen.getByRole('button', { name: 'Sil' }))
    await user.click(screen.getByRole('button', { name: 'Evet, sil' }))

    await waitFor(() => expect(screen.getByText('Henüz kural yok. Yukarıdan bir tane ekleyin.')).toBeInTheDocument())
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/v1/alert-rules/1')).toBe(true)
  })

  it('silme başarısız olursa mesaj gösterir ve satır kalır', async () => {
    stubFetch({ ...rulesRoutes(() => [makeRule({ id: 1, name: 'Kural' })]), 'DELETE /api/v1/alert-rules/1': () => textResponse('sunucu hatası', 500) })
    const user = userEvent.setup()
    renderPage()
    await screen.findByTestId('rule-row')

    await user.click(screen.getByRole('button', { name: 'Sil' }))
    await user.click(screen.getByRole('button', { name: 'Evet, sil' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('sunucu hatası')
    expect(screen.getByTestId('rule-row')).toHaveTextContent('Kural')
  })

  it('yükleme hatasında mesaj ve "Yeniden dene" gösterir', async () => {
    let fail = true
    stubFetch({
      'GET /api/v1/alert-rules': () => (fail ? textResponse('bozuk', 500) : jsonResponse([])),
      'GET /api/v1/nodes': () => jsonResponse([]),
    })
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Alarm kuralları alınamadı (HTTP 500).')
    fail = false
    await user.click(screen.getByRole('button', { name: 'Yeniden dene' }))

    expect(await screen.findByText('Henüz kural yok. Yukarıdan bir tane ekleyin.')).toBeInTheDocument()
  })
})
