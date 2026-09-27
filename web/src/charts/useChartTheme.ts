import { useMemo } from 'react'
import { readChartTheme, type ChartTheme } from './theme'
import { useColorScheme } from './useColorScheme'

/**
 * Chart colour theme, re-read when the browser's dark/light setting changes. readChartTheme does not use
 * `scheme` directly, but its result depends on it through the CSS variables, so `scheme` is a deliberate
 * dependency even though the lint rule calls it unnecessary.
 */
export function useChartTheme(): ChartTheme {
  const scheme = useColorScheme()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => readChartTheme(), [scheme])
}
