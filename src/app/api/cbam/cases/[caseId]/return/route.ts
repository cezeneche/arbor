import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionUser } from '@/lib/session'
import { requireWriteAccess } from '@/lib/auth-helpers'
import { err } from '@/lib/api-helpers'
import { resolveCaseAccess } from '@/lib/nucleos/case-ownership'
import {
  ReturnNotAvailableError,
  buildEuXmlDeclaration,
  buildHmrcReturn,
} from '@/lib/nucleos/return-client'
import { NucleosUnavailableError } from '@/lib/nucleos/extraction-client'
import { availableReturns, resolveJurisdiction } from '@/lib/nucleos/jurisdiction'
import { getCbamCase } from '@/lib/nucleos/cases-client'

// The regulatory output for a case: the HMRC return, or the EU registry XML.
//
// Streams the file straight through rather than parsing and re-serialising it.
// A return is a document that gets filed; re-encoding it here would put Arbor
// between the builder and the filing, and a byte Arbor changed is a byte the
// engine's version stamp no longer accounts for.

const bodySchema = z.object({
  format: z.enum(['HMRC_RETURN', 'EU_XML']),
  // Required by the HMRC builder, and only by it.
  importerVatNumber: z.string().min(1).max(30).optional(),
  importerAddress: z.record(z.string(), z.string()).optional(),
  accuracyDeclaration: z.boolean().optional(),
  cbamRateOverride: z.number().positive().optional(),
  hmrcFormat: z.enum(['json', 'pdf']).optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ caseId: string }> },
) {
  const { session, response } = await requireWriteAccess()
  if (!session) return response!

  const entityId = getSessionUser(session).entityId as string
  const { caseId } = await params

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return err('Invalid request body', 'VALIDATION_ERROR', 400)

  // A regulatory return is a filing. It is built only for a case this entity's
  // own link row names — never for another organisation's, and never for one
  // with no recorded owner.
  const access = await resolveCaseAccess(caseId, entityId)
  if (!access.allowed) return err('This case could not be found.', 'NOT_FOUND', 404)

  // Which outputs this case can produce is the case's own jurisdiction, not the
  // entity's current preference. Offering a UK importer an EU registry XML
  // would offer them something they can never file.
  let caseRecord: Record<string, unknown>
  try {
    caseRecord = await getCbamCase(caseId)
  } catch (e) {
    return err(
      `This case could not be read, so no return was produced: ${(e as Error).message}`,
      'NUCLEOS_UNAVAILABLE',
      502,
    )
  }

  const allowed = availableReturns(resolveJurisdiction(caseRecord.jurisdiction))
  if (!allowed.includes(parsed.data.format)) {
    return err(
      parsed.data.format === 'EU_XML'
        ? 'This case is filed under the UK regime, which has no EU registry declaration.'
        : 'This case is filed under the EU regime, which has no HMRC return.',
      'WRONG_JURISDICTION',
      422,
    )
  }

  try {
    const doc =
      parsed.data.format === 'EU_XML'
        ? await buildEuXmlDeclaration(caseId)
        : await buildHmrcReturn(caseId, {
            importerVatNumber: parsed.data.importerVatNumber ?? '',
            importerAddress: parsed.data.importerAddress ?? {},
            accuracyDeclaration: parsed.data.accuracyDeclaration ?? false,
            cbamRateOverride: parsed.data.cbamRateOverride ?? null,
          }, { format: parsed.data.hmrcFormat ?? 'json' })

    return new NextResponse(doc.body, {
      status: 200,
      headers: {
        'content-type': doc.contentType,
        'content-disposition': `attachment; filename="${doc.fileName}"`,
        // A regulatory return is built from live data at the moment it is
        // asked for. A cached one is a return for a case as it used to be.
        'cache-control': 'no-store',
      },
    })
  } catch (e) {
    // A refusal is not an outage, and the two need different actions from the
    // user. The builder's own words travel through: they name what to fix.
    if (e instanceof ReturnNotAvailableError) {
      return NextResponse.json(
        { error: e.message, code: 'RETURN_NOT_AVAILABLE', detail: e.detail },
        { status: 422 },
      )
    }
    if (e instanceof NucleosUnavailableError) {
      return err(e.message, 'NUCLEOS_UNAVAILABLE', 502)
    }
    throw e
  }
}
