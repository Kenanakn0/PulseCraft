import type { AlertRow, AlertStatus } from '../api/types'
import { jsonResponse } from './fetchStub'

/**
 * Answers `GET /api/v1/alerts?status=…` by filtering the given rows by status, like the server.
 * `getRows` is called per request, so a test can change the rows later.
 */
export function alertRoutes(getRows: () => AlertRow[]) {
  const route = (status: AlertStatus) => () => jsonResponse(getRows().filter((a) => a.status === status))
  return {
    'GET /api/v1/alerts?status=open': route('open'),
    'GET /api/v1/alerts?status=acknowledged': route('acknowledged'),
    'GET /api/v1/alerts?status=resolved': route('resolved'),
  }
}
