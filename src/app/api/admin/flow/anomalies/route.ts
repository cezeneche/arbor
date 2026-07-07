import { requireAdmin } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { buildCertificateClaims, type RawClaim } from '@/lib/flow/build-claims'
import { checkFlow } from '@/lib/brain/flow-client'
import { BrainUnavailableError } from '@/lib/brain/calibration-client'

// cross-tenant flow-consistency anomaly scan (ADMIN). The fraud
// signal only Arbor can see: a single-use reference (certificate, bill of lading,
// customs declaration) claimed by more than one entity — double counting /
// certificate laundering. Reads across all tenants' extractions, so it is
// strictly admin/platform scope. Read-only, off any write path, 503 if the brain
// is down. (Node-level flow-conservation over quantity-weighted supply edges is a
// noted follow-up once the graph carries flow quantities.)
const REF_FIELDS = ['certificate_number', 'bill_of_lading_number', 'declaration_reference']
const FIELD_CAP = 50000

export async function GET() {
  const { session, response } = await requireAdmin()
  if (!session) return response!

  const fields = await prisma.extractedField.findMany({
    where: { fieldName: { in: REF_FIELDS }, rawValue: { not: null } },
    select: {
      rawValue: true,
      extractionJob: { select: { document: { select: { entityId: true } } } },
    },
    take: FIELD_CAP,
  })

  const rows: RawClaim[] = fields.map(f => ({
    ref: f.rawValue,
    claimant: f.extractionJob.document.entityId,
  }))
  const claims = buildCertificateClaims(rows)

  if (claims.length === 0) {
    return ok({ status: 'noop', reason: 'no reference claims to scan' })
  }

  try {
    const { double_counting } = await checkFlow({ claims })
    return ok({
      status: 'ok',
      claimsScanned: claims.length,
      anomalyCount: double_counting.length,
      anomalies: double_counting,
    })
  } catch (e) {
    if (e instanceof BrainUnavailableError) {
      return err('Flow anomaly scan is temporarily unavailable', 'BRAIN_UNAVAILABLE', 503)
    }
    throw e
  }
}
