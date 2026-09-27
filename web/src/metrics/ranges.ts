// Time ranges of the detail page. `last` is sent to the server as a Go duration; the server builds the
// window from its own clock and returns raw data up to 3 hours, the 1-minute aggregate beyond.
export const RANGES = [
  { id: '15m', label: '15 dk', last: '15m', pollMs: 10_000 },
  { id: '1h', label: '1 sa', last: '1h', pollMs: 10_000 },
  { id: '6h', label: '6 sa', last: '6h', pollMs: 60_000 }, // the aggregate updates once a minute; polling faster is pointless
  { id: '24h', label: '24 sa', last: '24h', pollMs: 60_000 },
] as const

/** Derived from RANGES, so the two cannot drift apart. */
export type RangeId = (typeof RANGES)[number]['id']

export const DEFAULT_RANGE: RangeId = '15m'

export function getRange(id: RangeId) {
  // RANGES contains exactly the RangeIds, so this cannot fail; noUncheckedIndexedAccess still wants proof.
  return RANGES.find((r) => r.id === id) ?? RANGES[0]
}

/** Validates `?range=` from the URL; unknown values fall back to the default. */
export function parseRangeId(value: string | null): RangeId {
  return RANGES.find((r) => r.id === value)?.id ?? DEFAULT_RANGE
}
