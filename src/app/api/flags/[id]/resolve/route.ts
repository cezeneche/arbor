import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireWriteAccess } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { getSessionUser } from '@/lib/session'
import { parseNumericValue } from '@/lib/parse-numeric'
import { runSerializable } from '@/lib/layer2/serializable'
import { MAX_NOTE_LENGTH, resolveFlag, type FlagRefusal } from '@/lib/layer2/flag-resolution'
import { notifyBuyersOfSupersession } from '@/lib/supersession-notice'

// A supplier settles a flag on their own record from Review: keep the value
// with a note, or correct it. The rules are in resolveFlag (Layer 2); this reads
// the request and, once a correction commits, tells buyers who can see it.
const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('keep'), note: z.string().max(MAX_NOTE_LENGTH) }),
  z.object({ action: z.literal('correct'), value: z.union([z.string(), z.number()]) }),
])

const REFUSALS: Record<FlagRefusal, { status: number; message: string }> = {
  NOT_FOUND: { status: 404, message: 'This has already been dealt with, or is not yours to change.' },
  NOTE_REQUIRED: { status: 400, message: 'Say why the value is right, so anyone checking later can see.' },
  NEEDS_EVIDENCE: {
    status: 422,
    message: 'This one needs the value correcting or a corrected document - a note is not enough.',
  },
  INVALID_VALUE: { status: 400, message: 'Enter the corrected value as a number.' },
  UNCHANGED: { status: 400, message: 'That is the value already saved. Change it, or keep it with a note.' },
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, response } = await requireWriteAccess()
  if (!session) return response!
  const user = getSessionUser(session)
  const { id } = await params

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return err('Invalid request body', 'VALIDATION_ERROR', 400)

  let request: { action: 'keep'; note: string } | { action: 'correct'; value: number }
  if (parsed.data.action === 'correct') {
    const value =
      typeof parsed.data.value === 'number' ? parsed.data.value : parseNumericValue(parsed.data.value)
    if (value === null || !Number.isFinite(value)) {
      return err(REFUSALS.INVALID_VALUE.message, 'INVALID_VALUE', 400)
    }
    request = { action: 'correct', value }
  } else {
    request = { action: 'keep', note: parsed.data.note }
  }

  const result = await runSerializable(tx =>
    resolveFlag(tx, {
      flagId: id,
      entityId: user.entityId as string,
      userId: user.id as string,
      request,
      now: new Date(),
    }),
  )
  if (!result.ok) {
    const refusal = REFUSALS[result.reason]
    return err(refusal.message, result.reason, refusal.status)
  }

  if (result.action === 'corrected') {
    try {
      await notifyBuyersOfSupersession(user.entityId as string, [result.scope])
    } catch (e) {
      console.error('[flags/resolve] supersession notification failed:', e)
    }
    return ok({ action: 'corrected', recordId: result.recordId })
  }
  return ok({ action: 'kept' })
}
