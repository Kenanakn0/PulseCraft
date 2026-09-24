import { RANGES, type RangeId } from '../metrics/ranges'

interface RangeSelectorProps {
  value: RangeId
  onChange: (id: RangeId) => void
}

/** Zaman aralığı düğmeleri (15 dk / 1 sa / 6 sa / 24 sa). */
export function RangeSelector({ value, onChange }: RangeSelectorProps) {
  return (
    <div className="range-selector" role="group" aria-label="Zaman aralığı">
      {RANGES.map((range) => (
        <button
          key={range.id}
          type="button"
          className={range.id === value ? 'active' : undefined}
          aria-pressed={range.id === value}
          onClick={() => onChange(range.id)}
        >
          {range.label}
        </button>
      ))}
    </div>
  )
}
