import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { groupRecordsByDocument, type RecordRow } from '@/lib/constraints/group-records'
import { checkConstraints } from '@/lib/brain/constraints-client'
import { BrainUnavailableError } from '@/lib/brain/calibration-client'

// Upgrade 3 — physical-impossibility / fraud anomaly scan (ADMIN). Regroups the
// stored records by document and asks the brain whether each satisfies the
// algebraic constraints (emissions balance, non-negativity, plausible sector
// intensity) and what its missing fields complete to. On-demand analysis over
// certified data — read-only, off any write path, and fail-soft if the brain is
// down. This is the "reject the physically impossible / surface fraud" signal
// the rule-based admissibility spec can't see.
const RECORD_CAP = 20000

export async function GET(req: NextRequest) {
  const { session, response } = await requireAdmin()
  if (!session) return response!

  const entityId = req.nextUrl.searchParams.get('entityId')

  const records = await prisma.dataRecord.findMany({
    where: { isActive: true, documentId: { not: null }, ...(entityId ? { entityId } : {}) },
    select: { documentId: true, fieldName: true, value: true, entity: { select: { sector: true } } },
    take: RECORD_CAP,
  })

  const rows: RecordRow[] = records
    .filter(r => r.documentId)
    .map(r => ({
      documentId: r.documentId as string,
      fieldName: r.fieldName,
      value: r.value,
      sector: r.entity?.sector ?? null,
    }))
  const inputs = groupRecordsByDocument(rows)

  if (inputs.length === 0) {
    return ok({ status: 'noop', reason: 'no document-backed records to scan', entityId })
  }

  try {
    const results = await checkConstraints(inputs)
    const flagged = results.filter(r => r.violations.length > 0)
    return ok({
      status: 'ok',
      entityId,
      documentsScanned: inputs.length,
      documentsFlagged: flagged.length,
      criticalCount: flagged.reduce(
        (n, r) => n + r.violations.filter(v => v.severity === 'CRITICAL').length,
        0,
      ),
      flagged,
      // Documents whose missing fields the balance/bounds can complete.
      completable: results.filter(r => r.completions.length > 0),
    })
  } catch (e) {
    if (e instanceof BrainUnavailableError) {
      return err('Constraint scan is temporarily unavailable', 'BRAIN_UNAVAILABLE', 503)
    }
    throw e
  }
}
