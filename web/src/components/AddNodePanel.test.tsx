import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { jsonResponse, stubFetch, textResponse } from '../test/fetchStub'
import { AddNodePanel } from './AddNodePanel'

const KEY = 'a'.repeat(64)

describe('AddNodePanel', () => {
  it('düğmeyle açılır; boş ad istek göndermeden hata verir', async () => {
    const { calls } = stubFetch({})
    const user = userEvent.setup()
    render(<AddNodePanel onCreated={() => undefined} />)

    await user.click(screen.getByRole('button', { name: 'Sunucu ekle' }))
    await user.type(screen.getByLabelText('Sunucu adı'), '   ')
    await user.click(screen.getByRole('button', { name: 'Ekle' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Sunucu adı zorunlu.')
    expect(calls).toHaveLength(0)
  })

  it('başarıda kırpılmış adla oluşturur, listeyi yeniletir ve anahtarı BİR KEZ gösterir', async () => {
    const { calls } = stubFetch({
      'POST /api/v1/nodes': () => jsonResponse({ id: 'n9', name: 'web-01', api_key: KEY }, 201),
    })
    const onCreated = vi.fn()
    const user = userEvent.setup()
    render(<AddNodePanel onCreated={onCreated} />)

    await user.click(screen.getByRole('button', { name: 'Sunucu ekle' }))
    await user.type(screen.getByLabelText('Sunucu adı'), '  web-01  ')
    await user.click(screen.getByRole('button', { name: 'Ekle' }))

    expect(await screen.findByLabelText('API anahtarı')).toHaveValue(KEY)
    expect(screen.getByText(/yalnızca şimdi/)).toBeInTheDocument()
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'web-01' })
    expect(onCreated).toHaveBeenCalledTimes(1)
    // The key is never embedded in a command: the start command has no key, the agent asks for it hidden.
    const command = screen.getByText(/go -C agent run \.\/cmd\/agent/)
    expect(command).toHaveTextContent(`"-server=${window.location.origin}"`)
    expect(command.textContent).not.toContain(KEY)
    expect(command.textContent).not.toMatch(/api-key|Get-Clipboard/)
    expect(screen.getByText(/ekranda/)).toBeInTheDocument()
    expect(screen.getByTestId('agent-status')).toHaveTextContent('Agent bekleniyor')

    // Closing removes the key from the DOM and the state; reopening shows an empty form.
    await user.click(screen.getByRole('button', { name: 'Tamam, anahtarı kaydettim' }))
    expect(screen.queryByDisplayValue(KEY)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sunucu ekle' }))
    expect(screen.getByLabelText('Sunucu adı')).toHaveValue('')
    expect(screen.queryByDisplayValue(KEY)).not.toBeInTheDocument()
  })

  it('agent bağlanınca panel "bekleniyor"dan "bağlandı"ya geçer (yalnızca YENİ sunucu için)', async () => {
    stubFetch({ 'POST /api/v1/nodes': () => jsonResponse({ id: 'n9', name: 'web-01', api_key: KEY }, 201) })
    const user = userEvent.setup()
    let online = new Set<string>(['baska-sunucu'])
    const { rerender } = render(<AddNodePanel onCreated={() => undefined} isOnline={(id) => online.has(id)} />)

    await user.click(screen.getByRole('button', { name: 'Sunucu ekle' }))
    await user.type(screen.getByLabelText('Sunucu adı'), 'web-01')
    await user.click(screen.getByRole('button', { name: 'Ekle' }))
    expect(await screen.findByTestId('agent-status')).toHaveTextContent('Agent bekleniyor')

    online = new Set(['baska-sunucu', 'n9'])
    rerender(<AddNodePanel onCreated={() => undefined} isOnline={(id) => online.has(id)} />)
    expect(screen.getByTestId('agent-status')).toHaveTextContent('Agent bağlandı')
  })

  it('"Kopyala" anahtarı panoya yazar; pano yoksa elle kopyalama yönergesi gösterir', async () => {
    stubFetch({ 'POST /api/v1/nodes': () => jsonResponse({ id: 'n9', name: 'web-01', api_key: KEY }, 201) })
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<AddNodePanel onCreated={() => undefined} />)

    await user.click(screen.getByRole('button', { name: 'Sunucu ekle' }))
    await user.type(screen.getByLabelText('Sunucu adı'), 'web-01')
    await user.click(screen.getByRole('button', { name: 'Ekle' }))
    await user.click(await screen.findByRole('button', { name: 'Kopyala' }))

    expect(writeText).toHaveBeenCalledWith(KEY)
    expect(await screen.findByText('Panoya kopyalandı.')).toBeInTheDocument()

    writeText.mockRejectedValueOnce(new Error('izin yok'))
    await user.click(screen.getByRole('button', { name: 'Kopyala' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Kopyalanamadı')
  })

  it('sunucu 400 verirse mesajını gösterir, form ve ad korunur', async () => {
    stubFetch({ 'POST /api/v1/nodes': () => textResponse('name en fazla 100 karakter olabilir', 400) })
    const onCreated = vi.fn()
    const user = userEvent.setup()
    render(<AddNodePanel onCreated={onCreated} />)

    await user.click(screen.getByRole('button', { name: 'Sunucu ekle' }))
    await user.type(screen.getByLabelText('Sunucu adı'), 'web-01')
    await user.click(screen.getByRole('button', { name: 'Ekle' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('name en fazla 100 karakter olabilir')
    expect(screen.getByLabelText('Sunucu adı')).toHaveValue('web-01')
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('istek sürerken düğme kilitlenir (çift tıklama tek sunucu oluşturur)', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((r) => (release = r))
    const { calls } = stubFetch({
      'POST /api/v1/nodes': async () => {
        await gate
        return jsonResponse({ id: 'n9', name: 'web-01', api_key: KEY }, 201)
      },
    })
    const user = userEvent.setup()
    render(<AddNodePanel onCreated={() => undefined} />)

    await user.click(screen.getByRole('button', { name: 'Sunucu ekle' }))
    await user.type(screen.getByLabelText('Sunucu adı'), 'web-01')
    await user.click(screen.getByRole('button', { name: 'Ekle' }))
    await user.click(screen.getByRole('button', { name: 'Ekleniyor…' }))

    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)
    release?.()
    await waitFor(() => expect(screen.getByLabelText('API anahtarı')).toHaveValue(KEY))
  })
})
