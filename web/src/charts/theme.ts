/** Canvas'a çizilen grafiklerin kullandığı renkler. */
export interface ChartTheme {
  text: string
  grid: string
  cpu: string
  mem: string
  rx: string
  tx: string
  ok: string
  warn: string
  crit: string
  track: string
}

const FALLBACK: ChartTheme = {
  text: '#667085',
  grid: '#d9dde5',
  cpu: '#2453d6',
  mem: '#b8590a',
  rx: '#157f3c',
  tx: '#8a3ffc',
  ok: '#157f3c',
  warn: '#b8790a',
  crit: '#c4271f',
  track: '#eceef2',
}

/**
 * Renkleri CSS değişkenlerinden okur (index.css). Canvas CSS'i kendiliğinden bilmez, bu yüzden
 * çizim sırasında hesaplanmış stilden alınır; değişken tanımlı değilse (ör. testler) varsayılan kullanılır.
 */
export function readChartTheme(root: Element = document.documentElement): ChartTheme {
  const style = getComputedStyle(root)
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback

  return {
    text: read('--muted', FALLBACK.text),
    grid: read('--border', FALLBACK.grid),
    cpu: read('--series-cpu', FALLBACK.cpu),
    mem: read('--series-mem', FALLBACK.mem),
    rx: read('--series-rx', FALLBACK.rx),
    tx: read('--series-tx', FALLBACK.tx),
    ok: read('--gauge-ok', FALLBACK.ok),
    warn: read('--gauge-warn', FALLBACK.warn),
    crit: read('--gauge-crit', FALLBACK.crit),
    track: read('--off-bg', FALLBACK.track),
  }
}
