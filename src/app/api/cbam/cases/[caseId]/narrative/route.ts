import { NextResponse } from 'next/server'
import { requireWriteAccess } from '@/lib/auth-helpers'
import { getSessionUser } from '@/lib/session'
import { resolveCaseAccess } from '@/lib/nucleos/case-ownership'
import { getCbamCase } from '@/lib/nucleos/cases-client'
import { defaultNarrativeDeps, writeNarrative } from '@/lib/layer2/cbam-narrative'

// Write a CBAM case's audit narrative. Nucleos writes it and checks it against
// the figures; Arbor keeps it and emails the organisation when it needs review.

// One Claude call of up to a minute, after Nucleos's own cold start.
export const maxDuration = 120

const STATUS = { NOT_ALLOWED: 503, BLOCKED: 422, UNAVAILABLE: 502 } as const

export async function POST(_request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { session, response } = await requireWriteAccess()
  if (!session) return response!
  const user = getSessionUser(session)
  const entityId = user.entityId as string
  const { caseId } = await params

  const access = await resolveCaseAccess(caseId, entityId)
  if (!access.allowed) return NextResponse.json({ error: 'This case could not be found.' }, { status: 404 })

  // The email names the case the way the case list does; the id will do if
  // the case cannot be read for its name.
  let caseLabel = `case ${caseId}`
  try {
    const record = await getCbamCase(caseId)
    if (record.importer_eori && record.reporting_year && record.reporting_quarter) {
      caseLabel = `${record.importer_eori} · ${record.reporting_year} Q${record.reporting_quarter}`
    }
  } catch {
    // Named by id.
  }

  const result = await writeNarrative(
    { entityId, userId: user.id as string, caseId, caseLabel },
    await defaultNarrativeDeps(),
  )
  if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: STATUS[result.code] })
  return NextResponse.json(result, { status: 201 })
}
