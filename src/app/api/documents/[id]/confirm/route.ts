import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { z } from 'zod'
import { requireWriteAccess } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { writeRecordWithAuditEntry } from '@/lib/layer2/record-writer'
import { findDuplicates } from '@/lib/layer2/duplicate-check'
import { runSerializable } from '@/lib/layer2/serializable'
import { runCrossValidation } from '@/lib/validation/cross-validation'
import { assertRecordCapacity } from '@/lib/plan-guard'
import { runConstraintValidation } from '@/lib/constraints/run-constraint-validation'
import { buildReviewLabels } from '@/lib/confidence/review-capture'
import { validateConfirmFields, deriveTrustTier } from '@/lib/layer2/confirm-validation'
import { parseNumericValue } from '@/lib/parse-numeric'
import { ExtractionMethod, TrustTier, type DataDomain, type GroundTruthSource } from '@prisma/client'
import { normaliseToSI, isSupportedUnit } from '@/lib/layer3/unit-conversion'
import { DOCUMENT_FIELD_DEFINITIONS } from '@/lib/extraction/field-definitions'
import { computeStaleAfterDate } from '@/lib/layer2/staleness'
import { findActiveGranteeEntityIds } from '@/lib/layer3/grant-access'
import { sendNotification } from '@/lib/notifications'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'

const fieldSchema = z.object({
  fieldName: z.string(),
  confirmedValue: z.string(),
  confirmedUnit: z.string().optional(),
  domain: z.enum(['ENERGY', 'MATERIALS', 'PRODUCTION', 'LOGISTICS', 'EMISSIONS', 'AGRICULTURE', 'WASTE_AND_WATER', 'COMPLIANCE']),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  sourceText: z.string().optional(),
  confidenceScore: z.number().min(0).max(1).optional(),
})

const bodySchema = z.object({
  fields: z.array(fieldSchema).min(1),
  // Absent means the client has not been asked yet. When a confirm would
  // duplicate something already stored, the request is refused with the list so
  // the user can decide — the write path never picks for them.
  onDuplicate: z.enum(['replace', 'keep_both']).optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, response } = await requireWriteAccess()
  if (!session) return response!

  const entityId = getSessionUser(session).entityId as string
  const { id: documentId } = await params

  const body = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return err('Invalid request body', 'VALIDATION_ERROR', 400)

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
  if (document.status === 'ACCEPTED') return err('Document already confirmed', 'ALREADY_CONFIRMED', 409)

  const job = document.extractionJobs[0]
  const fieldDefs = DOCUMENT_FIELD_DEFINITIONS[document.documentType] ?? []
  const compulsoryFieldNames = new Set(
    fieldDefs.filter((f) => f.admissibility === 'compulsory').map((f) => f.name)
  )

  // Nothing is written until the whole payload is admissible. A confirmation is
  // the point at which a probabilistic extraction becomes a permanent chained
  // record, so a value that cannot be parsed, a period that runs backwards, a
  // field this document type does not have, or a unit that could never be
  // converted are all refusals — not fields to quietly drop.
  const fieldErrors = validateConfirmFields(parsed.data.fields, {
    knownFieldNames: new Set(fieldDefs.map(f => f.name)),
  })
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

  // Trust tier is re-derived server-side, and from the effective document — the
  // extraction with the reviewer's corrections applied — so clearing a compulsory
  // field during review downgrades the record instead of leaving it Verified.
  const trustTier: TrustTier =
    deriveTrustTier({
      extracted: new Map((job?.extractedFields ?? []).map(f => [f.fieldName, f.rawValue])),
      confirmed: new Map(parsed.data.fields.map(f => [f.fieldName, f.confirmedValue])),
      compulsory: compulsoryFieldNames,
      hasExtraction: Boolean(job),
    }) === 'A'
      ? TrustTier.A
      : TrustTier.B

  // Pre-compute normalised values outside the transaction (pure, no DB).
  type PreparedField = {
    field: typeof parsed.data.fields[number]
    rawNum: number
    siValue: number
    siUnit: string
    periodStart: Date
    periodEnd: Date
  }

  const preparedFields: PreparedField[] = parsed.data.fields.map(field => {
    // validateConfirmFields has already established that every value parses and
    // every supplied unit is one normaliseToSI knows.
    const rawNum = parseNumericValue(field.confirmedValue)!
    const unit = field.confirmedUnit ?? 'unknown'
    const { value: siValue, siUnit } = isSupportedUnit(unit)
      ? normaliseToSI(rawNum, unit)
      : { value: rawNum, siUnit: unit }

    return {
      field,
      rawNum,
      siValue,
      siUnit,
      periodStart: new Date(field.periodStart),
      periodEnd: new Date(field.periodEnd),
    }
  })

  // Single serializable transaction: all records + supersessions + document status.
  // If any field write fails the entire confirmation rolls back — no partial state.
  // Always ask before duplicating. The supersession below matches exactly on
  // domain, field and both period boundaries; this check is looser — same
  // field, overlapping period — because that is what the exact match misses,
  // and a miss leaves two active records that double-count on every total.
  const candidates = preparedFields.map(({ field, periodStart, periodEnd }) => ({
    fieldName: field.fieldName,
    domain: field.domain,
    periodStart,
    periodEnd,
  }))
  const priors = await prisma.dataRecord.findMany({
    where: {
      entityId,
      isActive: true,
      fieldName: { in: [...new Set(candidates.map(c => c.fieldName))] },
      documentId: { not: documentId },
    },
    select: { id: true, fieldName: true, domain: true, value: true, unit: true, periodStart: true, periodEnd: true },
  })
  const duplicates = findDuplicates(candidates, priors)

  if (duplicates.length > 0 && !parsed.data.onDuplicate) {
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
  const replacePriorIds = new Set(
    parsed.data.onDuplicate === 'replace' ? duplicates.flatMap(d => d.priorIds) : [],
  )

  // scopes whose prior records were superseded, so we can notify buyers.
  const supersededScopes: { domain: string; periodStart: Date; periodEnd: Date }[] = []

  // A sentinel rather than a returned error, so a second confirmation aborts the
  // transaction instead of half-writing. runSerializable rethrows anything that
  // is not a write conflict, so it reaches the handler below untouched.
  class AlreadyConfirmed extends Error {}
  class OverCapacity extends Error {
    constructor(readonly detail: string) { super(detail) }
  }

  let createdRecords: string[]
  try {
    createdRecords = await runSerializable(async (tx) => {
    const recordIds: string[] = []

    // The interactive confirm path wrote records without ever consulting the
    // plan cap. Counted inside the transaction that writes, so concurrent
    // confirmations cannot both take the last of the allowance.
    const capacity = await assertRecordCapacity(entityId, preparedFields.length, tx)
    if (!capacity.allowed) throw new OverCapacity(capacity.reason!)

    // Claim the document inside the transaction. The check above is a fast path
    // for the common case; on its own it left a window in which two confirmations
    // in flight together both passed it and both wrote a full set of records.
    const claimed = await tx.document.updateMany({
      where: { id: documentId, entityId, status: { not: 'ACCEPTED' } },
      data: { status: 'ACCEPTED' },
    })
    if (claimed.count === 0) throw new AlreadyConfirmed()

    for (const { field, rawNum, siValue, siUnit, periodStart, periodEnd } of preparedFields) {
      // Supersede any existing active records for the same entity+domain+fieldName+period.
      // keep_both means exactly that: write alongside, supersede nothing.
      const prior = parsed.data.onDuplicate === 'keep_both'
        ? []
        : await tx.dataRecord.findMany({
            where: {
              entityId,
              isActive: true,
              OR: [
                { domain: field.domain, fieldName: field.fieldName, periodStart, periodEnd },
                { id: { in: [...replacePriorIds] } },
              ],
            },
            select: { id: true },
          })

      const result = await writeRecordWithAuditEntry(
        tx,
        {
          entityId,
          domain: field.domain,
          fieldName: field.fieldName,
          value: siValue,
          unit: siUnit,
          originalValue: rawNum,
          originalUnit: field.confirmedUnit ?? 'unknown',
          periodStart,
          periodEnd,
          trustTier,
          extractionMethod: ExtractionMethod.DOCUMENT_AI,
          submittedById: session.user!.id!,
          documentId,
          sourceText: field.sourceText,
          confidenceScore: field.confidenceScore,
          staleAfterDate: computeStaleAfterDate(document.documentType, periodEnd),
        },
        'CREATED',
      )

      if (prior.length > 0) {
        await tx.dataRecord.updateMany({
          where: { id: { in: prior.map(p => p.id) } },
          data: { isActive: false, supersededById: result.recordId },
        })
        supersededScopes.push({ domain: field.domain, periodStart, periodEnd })
      }

      recordIds.push(result.recordId)
    }

    return recordIds
    })
  } catch (e) {
    if (e instanceof AlreadyConfirmed) {
      return err('Document already confirmed', 'ALREADY_CONFIRMED', 409)
    }
    if (e instanceof OverCapacity) {
      return err(e.detail, 'PLAN_LIMIT', 402)
    }
    throw e
  }

  // Cross-validation runs after commit — it reads accepted records and writes CV results.
  // Failures here do not roll back the confirmation (warnings only, not blocking).
  await runCrossValidation(entityId, documentId, document.documentType).catch(
    (e) => console.error('[confirm] runCrossValidation failed:', e)
  )

  // algebraic-constraint intake flagging: raise non-blocking
  // ValidationFlags for physically impossible / fraudulent records (mass
  // balance, non-negativity, implausible sector intensity). Post-commit,
  // fail-soft — the brain must never block or roll back a confirmation.
  await runConstraintValidation(documentId).catch(
    (e) => console.error('[confirm] runConstraintValidation failed:', e)
  )

  // capture calibration ground truth: compare what the reviewer
  // confirmed against what the model extracted, one GroundTruthLabel per
  // AI-extracted field. Best-effort and post-commit — training signal must
  // never roll back or block a confirmation.
  if (job) {
    try {
      const recordIdByField: Record<string, string | null> = {}
      preparedFields.forEach((p, i) => {
        recordIdByField[p.field.fieldName] = createdRecords[i] ?? null
      })
      const labels = buildReviewLabels({
        entityId,
        documentId,
        documentClass: job.documentClass ?? document.documentType,
        extractorVersion: job.extractorVersion ?? null,
        extractedFields: job.extractedFields.map((f) => ({
          fieldName: f.fieldName,
          rawValue: f.rawValue,
          confidenceScore: f.confidenceScore,
          admissibility: f.admissibility,
          flagged: f.flagged,
        })),
        confirmedFields: parsed.data.fields.map((f) => ({
          fieldName: f.fieldName,
          confirmedValue: f.confirmedValue,
          domain: f.domain,
        })),
        recordIdByField,
      })
      if (labels.length > 0) {
        await prisma.groundTruthLabel.createMany({
          data: labels.map((l) => ({
            entityId: l.entityId,
            documentId: l.documentId,
            recordId: l.recordId,
            fieldName: l.fieldName,
            documentClass: l.documentClass,
            domain: l.domain as DataDomain,
            extractedValue: l.extractedValue,
            confirmedValue: l.confirmedValue,
            wasCorrect: l.wasCorrect,
            confidenceAtExtraction: l.confidenceAtExtraction,
            source: l.source as GroundTruthSource,
            expectedInformationGain: l.expectedInformationGain,
            lowInformation: l.lowInformation,
            extractorVersion: l.extractorVersion,
          })),
        })
      }
    } catch (e) {
      console.error('[confirm] ground-truth label capture failed:', e)
    }
  }

  // notify any buyer with active access that a record they can see was
  // corrected. Deduplicated per grantee+domain. Non-fatal.
  if (supersededScopes.length > 0) {
    try {
      const supplier = await prisma.entity.findUnique({ where: { id: entityId }, select: { legalName: true } })
      const notified = new Set<string>()
      for (const scope of supersededScopes) {
        const grantees = await findActiveGranteeEntityIds(entityId, scope.domain, scope.periodStart, scope.periodEnd)
        for (const granteeEntityId of grantees) {
          const dedupKey = `${granteeEntityId}:${scope.domain}`
          if (notified.has(dedupKey)) continue
          notified.add(dedupKey)
          await sendNotification({
            entityId: granteeEntityId,
            type: 'RECORD_SUPERSEDED',
            payload: {
              supplierName: supplier?.legalName ?? 'A supplier',
              domain: scope.domain,
              periodStart: scope.periodStart.toISOString().slice(0, 10),
              periodEnd: scope.periodEnd.toISOString().slice(0, 10),
            },
          })
          // webhook to the buyer for the supersession.
          await dispatchWebhook(granteeEntityId, 'record.superseded', {
            supplierEntityId: entityId,
            domain: scope.domain,
            periodStart: scope.periodStart.toISOString(),
            periodEnd: scope.periodEnd.toISOString(),
          })
        }
      }
    } catch (e) {
      console.error('[confirm] supersession notification failed:', e)
    }
  }

  // fire record.certified webhooks for newly written Tier A records to
  // any buyer with active access covering that scope.
  if (trustTier === 'A' && preparedFields.length > 0) {
    try {
      const certifiedScopes = new Map<string, { domain: string; periodStart: Date; periodEnd: Date }>()
      for (const { field, periodStart, periodEnd } of preparedFields) {
        certifiedScopes.set(`${field.domain}:${periodStart.toISOString()}:${periodEnd.toISOString()}`, {
          domain: field.domain,
          periodStart,
          periodEnd,
        })
      }
      const fired = new Set<string>()
      for (const scope of certifiedScopes.values()) {
        const grantees = await findActiveGranteeEntityIds(entityId, scope.domain, scope.periodStart, scope.periodEnd)
        for (const granteeEntityId of grantees) {
          const key = `${granteeEntityId}:${scope.domain}`
          if (fired.has(key)) continue
          fired.add(key)
          await dispatchWebhook(granteeEntityId, 'record.certified', {
            supplierEntityId: entityId,
            domain: scope.domain,
            trustTier: 'A',
            periodStart: scope.periodStart.toISOString(),
            periodEnd: scope.periodEnd.toISOString(),
          })
        }
      }
    } catch (e) {
      console.error('[confirm] record.certified webhook failed:', e)
    }
  }

  return ok({ recordIds: createdRecords, documentStatus: 'ACCEPTED' })
}
