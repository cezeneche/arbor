// Confirming a reviewed document: the point at which a probabilistic extraction
// becomes permanent, chained records. The steps live in src/lib/layer2/confirm/:
// what is admissible (check), the records it becomes (prepare), the writes, in
// one transaction (write), and what follows the commit (after-commit).
import { NextRequest, NextResponse } from 'next/server'
import { TrustTier } from '@prisma/client'
import { getSessionUser } from '@/lib/session'
import { requireWriteAccess } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { findDuplicates, replacementsByField } from '@/lib/layer2/duplicate-check'
import { runSerializable } from '@/lib/layer2/serializable'
import { reviewTier } from '@/lib/layer2/review-tier'
import { documentPeriod } from '@/lib/review/review-policy'
import { isCbamRelevant } from '@/lib/nucleos/cbam-relevance'
import { resolveJurisdiction } from '@/lib/nucleos/jurisdiction'
import { REQUEST_ID_HEADER } from '@/lib/request-id'
import { confirmRequestSchema } from '@/lib/layer2/confirm/request'
import { confirmFieldErrors, confirmedValuesOf, missingDocumentDateError } from '@/lib/layer2/confirm/check'
import { duplicateCandidates, prepareFields } from '@/lib/layer2/confirm/prepare'
import { AlreadyConfirmed, OverCapacity, writeConfirmation } from '@/lib/layer2/confirm/write'
import { afterConfirm } from '@/lib/layer2/confirm/after-commit'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, response } = await requireWriteAccess()
  if (!session) return response!

  const entityId = getSessionUser(session).entityId as string
  const { id: documentId } = await params

  const body = await req.json().catch(() => null)
  const parsed = confirmRequestSchema.safeParse(body)
  if (!parsed.success) return err('Invalid request body', 'VALIDATION_ERROR', 400)
  const request = parsed.data

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      extractionJobs: {
        orderBy: { completedAt: 'desc' },
        take: 1,
        include: { extractedFields: true },
      },
    },
  })
  if (!document) return err('Document not found', 'NOT_FOUND', 404)
  if (document.entityId !== entityId) return err('Access denied', 'FORBIDDEN', 403)
  // An auto-accepted document was saved Declared with nobody checking it, and
  // this confirmation is that check: it stays open until a person has done it.
  if (document.status === 'ACCEPTED' && !document.autoAcceptedAt) {
    return err('Document already confirmed', 'ALREADY_CONFIRMED', 409)
  }
  // Its records were withdrawn from the chain's active set. Confirming would
  // put them back with no withdrawal of the withdrawal on record.
  if (document.status === 'WITHDRAWN') return err('This document was removed', 'DOCUMENT_WITHDRAWN', 409)

  const job = document.extractionJobs[0]
  const cbamDocument = isCbamRelevant(document.documentType)

  const fieldErrors = confirmFieldErrors(document.documentType, cbamDocument, request.fields)
  if (fieldErrors.length > 0) {
    return NextResponse.json(
      {
        error: 'Some of these figures could not be saved. Check the ones highlighted.',
        code: 'FIELD_VALIDATION_ERROR',
        fields: fieldErrors,
      },
      { status: 400 },
    )
  }

  const confirmedValues = confirmedValuesOf(request)

  const missingDate = missingDocumentDateError(document.documentType, cbamDocument, confirmedValues)
  if (missingDate) {
    return NextResponse.json(
      { error: 'Add the import date before saving.', code: 'FIELD_VALIDATION_ERROR', fields: [missingDate] },
      { status: 400 },
    )
  }

  // Trust tier is re-derived server-side, and from the effective document — the
  // extraction with the reviewer's corrections applied — so clearing a compulsory
  // field during review downgrades the record instead of leaving it Verified.
  //
  // A CBAM document is judged against the CBAM vocabulary. The generic set is
  // the document type's fixed field list, which for a customs declaration names
  // `commodity_code` and `declared_weight` while a Nucleos extraction emits
  // `lines[0].cn_code` and `lines[0].net_mass_kg` — the two never intersect, so
  // the compulsory set could never be satisfied and every CBAM record came out
  // Declared no matter how well evidenced it was.
  //
  // Every other document goes through the one certification policy — the
  // admissibility spec extraction applied — so review can supply what was
  // missing but cannot turn an estimate, an expired certificate or a document
  // with no spec into Verified evidence.
  //
  // What each extracted value was read from. Verified asserts a record can be
  // confirmed against its document, so a value with no text behind it cannot
  // carry the tier — whichever policy decides it.
  //
  // The review screen calls reviewTier with the same inputs, so the tier it
  // showed is the tier saved here.
  const entity = await prisma.entity.findUnique({
    where: { id: entityId },
    select: { legalName: true },
  })
  const tierIsA =
    reviewTier({
      documentType: document.documentType,
      cbam: cbamDocument,
      hasExtraction: Boolean(job),
      extracted: new Map((job?.extractedFields ?? []).map(f => [f.fieldName, f.rawValue])),
      confirmed: confirmedValues,
      sourceText: new Map<string, string | null>(
        (job?.extractedFields ?? []).map(f => [f.fieldName, f.sourceText]),
      ),
      entityName: entity?.legalName ?? '',
      recordPeriodEnds: request.fields.map(f => f.periodEnd),
    }) === 'A'
  const trustTier: TrustTier = tierIsA ? TrustTier.A : TrustTier.B

  const prepared = prepareFields(request.fields)

  // Always ask before duplicating.
  const candidates = duplicateCandidates(prepared, cbamDocument)
  const priors = await prisma.dataRecord.findMany({
    where: {
      entityId,
      isActive: true,
      fieldName: { in: [...new Set(candidates.map(c => c.fieldName))] },
      documentId: { not: documentId },
    },
    select: {
      id: true,
      fieldName: true,
      domain: true,
      value: true,
      unit: true,
      periodStart: true,
      periodEnd: true,
    },
  })
  const duplicates = findDuplicates(candidates, priors)
  if (duplicates.length > 0 && !request.onDuplicate) {
    // The list travels with the refusal so the prompt can quote what already
    // exists rather than asking the user to go and look.
    return NextResponse.json(
      {
        error: 'These figures already exist for this period. Choose whether to replace them or keep both.',
        code: 'DUPLICATE_RECORDS',
        duplicates,
      },
      { status: 409 },
    )
  }
  // Per field: each new record supersedes its own field's duplicates only.
  const replacePriorIds =
    request.onDuplicate === 'replace' ? replacementsByField(duplicates) : new Map<string, string[]>()

  // The CBAM handoff is recorded inside the transaction, so a confirmed CBAM
  // document can never exist without its handoff on record — and can be
  // resumed from that record if everything after the commit fails.
  const cbamHandoff = cbamDocument
    ? {
        documentId,
        entityId,
        documentType: document.documentType,
        jurisdiction: resolveJurisdiction(
          (
            await prisma.entity.findUnique({
              where: { id: entityId },
              select: { cbamJurisdiction: true },
            })
          )?.cbamJurisdiction,
        ),
        confirmed: confirmedValues,
        // From the confirmed document date, checked above, rather than the
        // periods the client sent: the quarter is the one fact about a case
        // that must come from the document.
        reportingPeriodEnd: documentPeriod(Object.fromEntries(confirmedValues), {
          documentType: document.documentType,
        })!.periodEnd,
        // What extraction read, so the case can show where each figure came from.
        readFields: (job?.extractedFields ?? []).map(f => ({
          fieldName: f.fieldName,
          extractedValue: f.rawValue,
          sourceText: f.sourceText,
          confidence: f.confidenceScore,
        })),
      }
    : null

  let written: Awaited<ReturnType<typeof writeConfirmation>>
  try {
    written = await runSerializable(tx =>
      writeConfirmation(tx, {
        documentId,
        entityId,
        userId: session.user!.id!,
        documentType: document.documentType,
        cbamDocument,
        prepared,
        trustTier,
        onDuplicate: request.onDuplicate,
        replacePriorIds,
        cbamHandoff,
      }),
    )
  } catch (e) {
    if (e instanceof AlreadyConfirmed) return err('Document already confirmed', 'ALREADY_CONFIRMED', 409)
    if (e instanceof OverCapacity) return err(e.detail, 'PLAN_LIMIT', 402)
    throw e
  }

  const cbam = await afterConfirm({
    documentId,
    entityId,
    documentType: document.documentType,
    requestId: req.headers.get(REQUEST_ID_HEADER),
    job,
    fields: request.fields,
    prepared,
    recordIds: written.recordIds,
    supersededScopes: written.supersededScopes,
    trustTier,
    cbamHandoff: Boolean(cbamHandoff),
  })

  return ok({
    recordIds: written.recordIds,
    documentStatus: 'ACCEPTED',
    ...(cbam
      ? {
          cbam: {
            caseId: cbam.caseId,
            status: cbam.status,
            problems: cbam.problems,
            needs: cbam.needs ?? [],
          },
        }
      : {}),
  })
}
