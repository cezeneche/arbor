import { NextRequest } from 'next/server'
import { Resend } from 'resend'
import { getSessionUser } from '@/lib/session'
import { requireWriteAccess } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { EMAIL_FROM } from '@/lib/email/config'
import { buildAnswerHtml, type FieldAnswerShape } from '@/lib/requests/answer-email'
import type { Prisma } from '@prisma/client'

// Supplier-initiated approve-and-send for an inbound data request that was
// matched to certified records and held for review (the S2 fix: nothing is ever
// emailed automatically). Only a write-capable member of the entity that owns
// the request can send, and only while it is awaiting supplier review.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, response } = await requireWriteAccess()
  if (!session) return response!
  const entityId = getSessionUser(session).entityId as string
  const { id } = await params

  const request = await prisma.inboundRequest.findUnique({
    where: { id },
    include: { entity: { select: { legalName: true } } },
  })
  if (!request || request.entityId !== entityId) {
    return err('Request not found', 'NOT_FOUND', 404)
  }
  if (request.status === 'ANSWERED') {
    return err('This request has already been answered', 'ALREADY_ANSWERED', 409)
  }

  const pf = (request.parsedFields ?? {}) as {
    awaiting?: string
    answers?: FieldAnswerShape[]
    parsed?: unknown
  }
  if (pf.awaiting !== 'supplier_review' || !pf.answers || pf.answers.length === 0) {
    return err(
      'This request has no matched answers to send — it needs data you haven’t uploaded yet.',
      'NOT_READY',
      409,
    )
  }
  if (!request.fromEmail) {
    return err('The original email had no reply address', 'NO_REPLY_ADDRESS', 409)
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return err('Email sending is not configured on this environment', 'EMAIL_UNCONFIGURED', 503)
  }

  // Claim the request BEFORE sending. Checking the status and then sending left a
  // window in which two clicks — or a double-submitted form — both passed the
  // check and both emailed the buyer. An email cannot be recalled, so the claim
  // has to come first: an unclaimable request is a request somebody else is
  // already answering.
  const claimed = await prisma.inboundRequest.updateMany({
    where: { id, entityId, status: { not: 'ANSWERED' } },
    data: {
      status: 'ANSWERED',
      answeredAt: new Date(),
      parsedFields: {
        ...pf,
        awaiting: undefined,
        sentBy: getSessionUser(session).id,
        sentAt: new Date().toISOString(),
      } as unknown as Prisma.InputJsonValue,
    },
  })
  if (claimed.count === 0) {
    return err('This request has already been answered', 'ALREADY_ANSWERED', 409)
  }

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from: EMAIL_FROM,
    to: request.fromEmail,
    subject: `Re: your data request to ${request.entity.legalName}`,
    html: buildAnswerHtml(request.entity.legalName, pf.answers),
  })

  if (error) {
    // Delivery failed, so release the claim and let the supplier try again. The
    // trade is deliberate: a released claim can be re-sent, whereas a claim held
    // through a failure would leave the buyer with no answer and no way to get one.
    console.error(`[inbound-requests] send for ${id} failed:`, error)
    await prisma.inboundRequest.updateMany({
      where: { id, status: 'ANSWERED' },
      data: { status: request.status, answeredAt: null, parsedFields: pf as unknown as Prisma.InputJsonValue },
    })
    return err('The email could not be delivered. Please try again.', 'SEND_FAILED', 502)
  }

  return ok({ id, status: 'ANSWERED' })
}
