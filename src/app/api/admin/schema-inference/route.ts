import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { inferSchema } from '@/lib/brain/schema-client'
import { BrainUnavailableError } from '@/lib/brain/calibration-client'

// Upgrade 2 — schema-inference analysis surface (ADMIN). Reads the corpus's
// completed extractions as one field-name list per document and asks the brain
// to classify the fields into core / co-varying groups / noise by mutual
// information. On-demand analysis (not a write/render path); fail-soft if the
// brain is down. Most useful scoped to GENERIC / schema-on-read documents via
// ?documentType, but works across any document type.
const JOB_CAP = 5000

export async function GET(req: NextRequest) {
  const { session, response } = await requireAdmin()
  if (!session) return response!

  const documentType = req.nextUrl.searchParams.get('documentType')

  const jobs = await prisma.extractionJob.findMany({
    where: {
      status: 'COMPLETE',
      ...(documentType ? { document: { documentType: documentType as never } } : {}),
    },
    select: { extractedFields: { select: { fieldName: true } } },
    take: JOB_CAP,
  })

  // One document = the set of field names extracted from it.
  const documents = jobs
    .map(j => [...new Set(j.extractedFields.map(f => f.fieldName))])
    .filter(fields => fields.length > 0)

  if (documents.length === 0) {
    return ok({ status: 'noop', reason: 'no completed extractions to infer from', documentType })
  }

  try {
    const schema = await inferSchema(documents)
    return ok({
      status: 'ok',
      documentType,
      documentsAnalysed: documents.length,
      core: schema.core,
      groups: schema.groups,
      noise: schema.noise,
      // Top field pairs by mutual information, for transparency.
      topPairs: [...schema.pairs].sort((a, b) => b.mi - a.mi).slice(0, 20),
    })
  } catch (e) {
    if (e instanceof BrainUnavailableError) {
      return err('Schema inference is temporarily unavailable', 'BRAIN_UNAVAILABLE', 503)
    }
    throw e
  }
}
