import type { NodeSummary } from '../api/types'

const percentFormat = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** 42.5 → "42,5 %" (Turkish decimal separator). */
export function formatPercent(value: number): string {
  return `${percentFormat.format(value)} %`
}

/**
 * Formats the server-reported seconds since last seen. The age is computed on the SERVER; the browser
 * clock is not used.
 */
export function formatAge(seconds: number | null): string {
  if (seconds === null) return 'hiç görülmedi'
  if (seconds < 5) return 'az önce'
  if (seconds < 60) return `${Math.floor(seconds)} sn önce`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} dk önce`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} sa önce`
  return `${Math.floor(seconds / 86400)} gün önce`
}

/**
 * Online first, then by name (Turkish collation). Returns a sorted COPY: arrays from props/state must
 * not be mutated.
 */
export function sortNodes(nodes: readonly NodeSummary[]): NodeSummary[] {
  return [...nodes].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1
    return a.name.localeCompare(b.name, 'tr')
  })
}
