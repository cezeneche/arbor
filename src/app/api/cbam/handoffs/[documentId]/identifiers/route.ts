import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireWriteAccess } from '@/lib/auth-helpers'
import { getSessionUser } from '@/lib/session'
import { supplyCbamHandoffIdentifiers } from '@/lib/layer2/cbam-handoff'

// Supply an identifier a confirmed document's case is waiting for — the
// importer's EORI, a goods line's commodity code — and open the case.
//
// The document stays confirmed and its records untouched: these are
// identifiers, not figures, and they fill gaps only. Who supplied each one is
// kept with the handoff.

const bodySchema = z.object({
  fields: z
    .array(z.object({ fieldName: z.string().min(1).max(100), value: z.string().max(100) }))
    .min(1)
    .max(50),
})

const STATUS_BY_CODE = { NOT_FOUND: 404, NOT_WAITING: 409, INVALID: 400 } as const

export async function POST(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const { session, response } = await requireWriteAccess()
  if (!session) return response!

  const user = getSessionUser(session)
  const { documentId } = await params

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body', code: 'VALIDATION_ERROR' }, { status: 400 })
  }

  const result = await supplyCbamHandoffIdentifiers({
    documentId,
    entityId: user.entityId as string,
    userId: user.id as string,
    amendments: parsed.data.fields,
  })

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.message,
        code: result.code,
        ...(result.code === 'INVALID' ? { fields: result.errors } : {}),
      },
      { status: STATUS_BY_CODE[result.code] },
    )
  }

  return NextResponse.json({
    caseId: result.outcome.caseId,
    status: result.outcome.status,
    problems: result.outcome.problems,
    needs: result.outcome.needs ?? [],
  })
}
