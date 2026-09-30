// Layer 2 — an audit narrative for a CBAM case: written by Nucleos, kept here.
//
// The narrative is stored as it came back, with the validator's verdict and
// the pack's hash, and never overwritten: writing it again adds a row. When the
// verdict is that a person must review it, the organisation's writers are
// emailed. Nucleos keeps its own Slack alert for the team; this is the
// customer's. An email that cannot be sent never loses the narrative.

import type { PrismaClient } from '@prisma/client'
import { escapeHtml } from '@/lib/email/client'
import { NucleosUnavailableError } from '@/lib/nucleos/extraction-client'
import {
  NarrativeBlockedError,
  NarrativeNotAllowedError,
  type CompliancePackResult,
} from '@/lib/nucleos/narrative-client'

export interface NarrativeEmail {
  subject: string
  text: string
  html: string
}

export interface NarrativeDeps {
  db: { cbamNarrative: Pick<PrismaClient['cbamNarrative'], 'create' | 'update'> }
  run: (caseId: string) => Promise<CompliancePackResult>
  /** Email addresses of the organisation's active users who can act on it. */
  recipients: (entityId: string) => Promise<string[]>
  send: (message: NarrativeEmail & { to: string }) => Promise<void>
  appUrl: string
  now?: () => Date
}

export type NarrativeResult =
  | { ok: true; narrativeId: string; reviewRequired: boolean; emailed: number; emailProblem: string | null }
  | { ok: false; code: 'NOT_ALLOWED' | 'BLOCKED' | 'UNAVAILABLE'; message: string }

export function narrativeReviewEmail(input: { caseLabel: string; reasons: string[]; link: string }): NarrativeEmail {
  const intro =
    'The audit narrative for this CBAM case was checked against the case’s figures, and a person needs to ' +
    'review it before it is relied on.'
  const reasons = input.reasons.length ? input.reasons : ['No reason was given.']
  return {
    subject: `A CBAM audit narrative needs review: ${input.caseLabel}`,
    text: [intro, '', 'What was found:', ...reasons.map(r => `- ${r}`), '', `Open the case: ${input.link}`].join('\n'),
    html:
      `<p>${escapeHtml(intro)}</p>` +
      `<p>What was found:</p><ul>${reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>` +
      `<p><a href="${escapeHtml(input.link)}">Open the case</a></p>`,
  }
}

export async function writeNarrative(
  input: { entityId: string; userId: string; caseId: string; caseLabel: string },
  deps: NarrativeDeps,
): Promise<NarrativeResult> {
  const now = deps.now ?? (() => new Date())

  let pack: CompliancePackResult
  try {
    pack = await deps.run(input.caseId)
  } catch (err) {
    if (err instanceof NarrativeNotAllowedError) {
      return {
        ok: false,
        code: 'NOT_ALLOWED',
        message:
          'Arbor is not yet allowed to write audit narratives. The Nucleos service token needs the narrative:run scope.',
      }
    }
    if (err instanceof NarrativeBlockedError) {
      return {
        ok: false,
        code: 'BLOCKED',
        message:
          'The case has gaps that stop a narrative being written' +
          (err.missing.length ? `: ${err.missing.join(', ')}.` : '.') +
          ' Fill them, then try again.',
      }
    }
    if (!(err instanceof NucleosUnavailableError)) console.error('[cbam-narrative] unexpected failure:', err)
    return { ok: false, code: 'UNAVAILABLE', message: 'The narrative could not be written just now. Try again shortly.' }
  }

  const row = await deps.db.cbamNarrative.create({
    data: {
      entityId: input.entityId,
      nucleosCaseId: input.caseId,
      generatedById: input.userId,
      reviewRequired: pack.review.required,
      reviewReasons: pack.review.reasons,
      narrative: pack.narrative as object,
      packHash: pack.packHash,
    },
  })

  if (!pack.review.required) {
    return { ok: true, narrativeId: row.id, reviewRequired: false, emailed: 0, emailProblem: null }
  }

  const message = narrativeReviewEmail({
    caseLabel: input.caseLabel,
    reasons: pack.review.reasons,
    link: `${deps.appUrl}/cbam/${encodeURIComponent(input.caseId)}`,
  })
  let emailed = 0
  let emailProblem: string | null = null
  try {
    const to = await deps.recipients(input.entityId)
    if (to.length === 0) emailProblem = 'No one in the organisation could be emailed about the review.'
    for (const address of to) {
      try {
        await deps.send({ ...message, to: address })
        emailed += 1
      } catch (err) {
        emailProblem = `The review notice could not be emailed to everyone: ${(err as Error).message}`
      }
    }
  } catch (err) {
    emailProblem = `The review notice could not be emailed: ${(err as Error).message}`
  }
  if (emailed > 0) {
    await deps.db.cbamNarrative.update({ where: { id: row.id }, data: { emailedAt: now() } })
  }
  return { ok: true, narrativeId: row.id, reviewRequired: true, emailed, emailProblem }
}

/** The real collaborators: Prisma, Nucleos, and Resend. */
export async function defaultNarrativeDeps(): Promise<NarrativeDeps> {
  const [{ prisma }, client, { getResend }, { EMAIL_FROM }] = await Promise.all([
    import('@/lib/prisma'),
    import('@/lib/nucleos/narrative-client'),
    import('@/lib/email/client'),
    import('@/lib/email/config'),
  ])
  return {
    db: prisma,
    run: caseId => client.runCompliancePack(caseId),
    recipients: async entityId =>
      (
        await prisma.user.findMany({
          where: { entityId, isActive: true, role: { in: ['ADMIN', 'CONTRIBUTOR'] } },
          select: { email: true },
        })
      ).map(u => u.email),
    send: async ({ to, subject, text, html }) => {
      const resend = getResend()
      if (!resend) throw new Error('RESEND_API_KEY is not set')
      const { error } = await resend.emails.send({ from: EMAIL_FROM, to, subject, text, html })
      if (error) throw new Error(error.message)
    },
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  }
}
