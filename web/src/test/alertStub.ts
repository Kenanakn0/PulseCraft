import type { AlertRow, AlertStatus } from '../api/types'
import { jsonResponse } from './fetchStub'

/**
 * `GET /api/v1/alerts?status=…` yanıtlarını, verilen satırları duruma göre süzerek üretir (sunucu gibi).
 * `getRows` her istekte çağrılır: test satırları sonradan değiştirebilir.
 */
export function alertRoutes(getRows: () => AlertRow[]) {
  const route = (status: AlertStatus) => () => jsonResponse(getRows().filter((a) => a.status === status))
  return {
    'GET /api/v1/alerts?status=open': route('open'),
    'GET /api/v1/alerts?status=acknowledged': route('acknowledged'),
    'GET /api/v1/alerts?status=resolved': route('resolved'),
  }
}
