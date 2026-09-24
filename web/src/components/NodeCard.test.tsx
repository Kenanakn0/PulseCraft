import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { makeNode } from '../test/fixtures'
import { NodeCard } from './NodeCard'

describe('NodeCard', () => {
  it('çevrimiçi sunucuyu ad, hostname·OS, değerler ve son görülmeyle gösterir', () => {
    render(<NodeCard node={makeNode()} />)

    const card = screen.getByTestId('node-card')
    expect(card).toHaveAttribute('data-online', 'true')
    expect(within(card).getByRole('heading', { name: 'web-01' })).toBeInTheDocument()
    expect(within(card).getByText('Çevrimiçi')).toBeInTheDocument()
    expect(within(card).getByText('web-01.example.test · linux')).toBeInTheDocument()
    expect(within(card).getByText('42,5 %')).toBeInTheDocument() // CPU
    expect(within(card).getByText('61,0 %')).toBeInTheDocument() // RAM
    expect(within(card).getByText('70,3 %')).toBeInTheDocument() // Disk (70.25 → yuvarlama)
    expect(within(card).getByText('Son görülme: az önce')).toBeInTheDocument()
  })

  it('çevrimdışı sunucuyu soluk (stale) değerlerle ve süreyle gösterir', () => {
    render(<NodeCard node={makeNode({ online: false, last_seen_seconds_ago: 300 })} />)

    const card = screen.getByTestId('node-card')
    expect(card).toHaveAttribute('data-online', 'false')
    expect(within(card).getByText('Çevrimdışı')).toBeInTheDocument()
    expect(card.querySelector('.node-metrics')).toHaveClass('stale')
    expect(within(card).getByText('Son görülme: 5 dk önce')).toBeInTheDocument()
  })

  it('hiç ölçümü/görülmesi olmayan sunucuyu gösterir', () => {
    render(<NodeCard node={makeNode({ latest: null, last_seen_at: null, last_seen_seconds_ago: null, online: false })} />)

    expect(screen.getByText('Henüz ölçüm yok')).toBeInTheDocument()
    expect(screen.getByText('Son görülme: hiç görülmedi')).toBeInTheDocument()
    expect(screen.queryByText('CPU')).not.toBeInTheDocument()
  })

  it('hostname ve OS yoksa tire gösterir; yalnızca biri varsa onu gösterir', () => {
    const { rerender } = render(<NodeCard node={makeNode({ hostname: null, os: null })} />)
    expect(screen.getByText('—')).toBeInTheDocument()

    rerender(<NodeCard node={makeNode({ hostname: null, os: 'windows' })} />)
    expect(screen.getByText('windows')).toBeInTheDocument()

    rerender(<NodeCard node={makeNode({ hostname: 'demo-1', os: '' })} />)
    expect(screen.getByText('demo-1')).toBeInTheDocument()
  })

  it('sunucu adı HTML olarak yorumlanmaz (React metni kaçırır)', () => {
    render(<NodeCard node={makeNode({ name: '<img src=x onerror=alert(1)>' })} />)

    expect(screen.getByRole('heading')).toHaveTextContent('<img src=x onerror=alert(1)>')
    expect(document.querySelector('img')).toBeNull()
  })
})
