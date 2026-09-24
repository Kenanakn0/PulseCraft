import { useMemo } from 'react'
import { readChartTheme, type ChartTheme } from './theme'
import { useColorScheme } from './useColorScheme'

/**
 * Grafiklerin renk teması. Tarayıcının koyu/açık ayarı değişince yeniden okunur.
 * (readChartTheme, `scheme`'e doğrudan bakmaz ama sonucu ona bağlıdır: CSS değişkenleri o ayara göre
 * değişir. Bu yüzden `scheme` bilerek bağımlılık listesindedir; lint kuralı bunu "gereksiz" sanar.)
 */
export function useChartTheme(): ChartTheme {
  const scheme = useColorScheme()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => readChartTheme(), [scheme])
}
