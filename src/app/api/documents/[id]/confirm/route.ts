import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { z } from 'zod'
import { requireWriteAccess } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { writeRecordWithAuditEntry } from '@/lib/layer2/record-writer'
import { runSerializable } from '@/lib/layer2/serializable'
import { runCrossValidation } from '@/lib/validation/cross-validation'
import { runConstraintValidation } from '@/lib/constraints/run-constraint-validation'
import { buildReviewLabels } from '@/lib/confidence/review-capture'
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

  // Re-derive trust tier server-side from the extraction job, not from the client.
  const job = document.extractionJobs[0]
  const fieldDefs = DOCUMENT_FIELD_DEFINITIONS[document.documentType] ?? []
  const compulsoryFieldNames = new Set(
    fieldDefs.filter((f) => f.admissibility === 'compulsory').map((f) => f.name)
  )

  let trustTier: TrustTier = TrustTier.A
  if (job) {
    const extractedFieldMap = new Map(job.extractedFields.map(f => [f.fieldName, f.rawValue]))
    for (const name of compulsoryFieldNames) {
      const raw = extractedFieldMap.get(name)
      if (raw === null || raw === undefined || raw === '') {
        trustTier = TrustTier.B
        break
      }
    }
  } else {
    trustTier = TrustTier.B
  }

  // Pre-compute normalised values outside the transaction (pure, no DB).
  type PreparedField = {
    field: typeof parsed.data.fields[number]
    rawNum: number
    siValue: number
    siUnit: string
    periodStart: Date
    periodEnd: Date
  }

  const preparedFields: PreparedField[] = []
  for (const field of parsed.data.fields) {
    const rawNum = parseNumericValue(field.confirmedValue) ?? NaN
    if (isNaN(rawNum)) continue

    const unit = field.confirmedUnit ?? 'unknown'
    const { value: siValue, siUnit } = isSupportedUnit(unit)
      ? normaliseToSI(rawNum, unit)
      : { value: rawNum, siUnit: unit }

    const periodStart = new Date(field.periodStart)
    const periodEnd = new Date(field.periodEnd)

    preparedFields.push({ field, rawNum, siValue, siUnit, periodStart, periodEnd })
  }

  // Single serializable transaction: all records + supersessions + document status.
  // If any field write fails the entire confirmation rolls back — no partial state.
  // Gap 5 — scopes whose prior records were superseded, so we can notify buyers.
  const supersededScopes: { domain: string; periodStart: Date; periodEnd: Date }[] = []

  const createdRecords = await runSerializable(async (tx) => {
    const recordIds: string[] = []

    for (const { field, rawNum, siValue, siUnit, periodStart, periodEnd } of preparedFields) {
      // Supersede any existing active records for the same entity+domain+fieldName+period.
      const prior = await tx.dataRecord.findMany({
        where: { entityId, domain: field.domain, fieldName: field.fieldName, periodStart, periodEnd, isActive: true },
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

    // Mark document accepted inside the transaction so status and records are consistent.
    await tx.document.update({
      where: { id: documentId },
      data: { status: 'ACCEPTED' },
    })

    return recordIds
  })

  // Cross-validation runs after commit — it reads accepted records and writes CV results.
  // Failures here do not roll back the confirmation (warnings only, not blocking).
  await runCrossValidation(entityId, documentId, document.documentType).catch(
    (e) => console.error('[confirm] runCrossValidation failed:', e)
  )

  // Upgrade 3 — algebraic-constraint intake flagging: raise non-blocking
  // ValidationFlags for physically impossible / fraudulent records (mass
  // balance, non-negativity, implausible sector intensity). Post-commit,
  // fail-soft — the brain must never block or roll back a confirmation.
  await runConstraintValidation(documentId).catch(
    (e) => console.error('[confirm] runConstraintValidation failed:', e)
  )

  // Upgrade 1 — capture calibration ground truth: compare what the reviewer
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
          })),
        })
      }
    } catch (e) {
      console.error('[confirm] ground-truth label capture failed:', e)
    }
  }

  // Gap 5 — notify any buyer with active access that a record they can see was
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
          // Gap 6 — webhook to the buyer for the supersession.
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

  // Gap 6 — fire record.certified webhooks for newly written Tier A records to
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
