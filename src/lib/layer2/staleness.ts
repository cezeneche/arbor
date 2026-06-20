// Layer 2 — batch-record staleness horizon. Pure function, no DB or AI.
//
// Certificates carry an explicit expiry_date. Batch/mill records (production
// logs, material intake, delivery notes) do not — they are valid only for the
// period they cover. We derive a staleness horizon so the platform can surface
// "this record is now stale" the same way it surfaces certificate expiry.
import { BATCH_RECORD_STALE_DAYS } from '@/lib/constants'

const BATCH_STALE_DOCUMENT_TYPES = new Set(['PRODUCTION_LOG', 'MATERIAL_INTAKE', 'DELIVERY_NOTE'])

export function computeStaleAfterDate(documentType: string, periodEnd: Date): Date | null {
  if (!BATCH_STALE_DOCUMENT_TYPES.has(documentType)) return null
  const stale = new Date(periodEnd)
  stale.setDate(stale.getDate() + BATCH_RECORD_STALE_DAYS)
  return stale
}
