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
import { validateConfirmFields } from '@/lib/layer2/confirm-validation'
import { certifyTier } from '@/lib/layer2/certification-policy'
import { parseNumericValue } from '@/lib/parse-numeric'
import { ExtractionMethod, TrustTier, type DataDomain, type GroundTruthSource } from '@prisma/client'
import { normaliseToSI, isSupportedUnit } from '@/lib/layer3/unit-conversion'
import { DOCUMENT_FIELD_DEFINITIONS } from '@/lib/extraction/field-definitions'
import { computeStaleAfterDate } from '@/lib/layer2/staleness'
import { findActiveGranteeEntityIds } from '@/lib/layer3/grant-access'
import { sendNotification } from '@/lib/notifications'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'
import { isCbamRelevant } from '@/lib/nucleos/cbam-relevance'
import {
  cbamCompulsoryFieldsPresent,
  isCbamFieldName,
  parseGoodsLineFieldName,
} from '@/lib/nucleos/cbam-fields'
import { resolveJurisdiction } from '@/lib/nucleos/jurisdiction'
import {
  enqueueCbamHandoff,
  runCbamHandoff,
  type CbamHandoffOutcome,
} from '@/lib/layer2/cbam-handoff'

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

// Confirmed values that are not measurements: an importer's EORI, a commodity
// code, a country of origin. They write no DataRecord — a record needs a value,
// a unit and a period, and none of these has any of the three — but the case a
// CBAM document produces cannot be assembled without them, and the reviewer's
// correction to one has to reach it. Reading them off the extraction instead
// would build the case from what the model read rather than what the human
// confirmed, which for a corrected EORI means filing under the wrong identity.
const contextSchema = z.object({
  fieldName: z.string(),
  confirmedValue: z.string(),
})

const bodySchema = z.object({
  fields: z.array(fieldSchema).min(1),
  context: z.array(contextSchema).optional(),
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

  // A CBAM document's field names are generated, one set per goods line, so no
  // fixed definition list can contain them. Checking them against the customs
  // declaration's list rejected every one as a field Arbor does not read — which
  // is why no Nucleos-extracted document could be confirmed at all.
  const cbamDocument = isCbamRelevant(document.documentType)
  const knownFieldNames = new Set(fieldDefs.map(f => f.name))

  // Nothing is written until the whole payload is admissible. A confirmation is
  // the point at which a probabilistic extraction becomes a permanent chained
  // record, so a value that cannot be parsed, a period that runs backwards, a
  // field this document type does not have, or a unit that could never be
  // converted are all refusals — not fields to quietly drop.
  const fieldErrors = validateConfirmFields(parsed.data.fields, {
    // Empty means "no definition on file", which the validator reads as "do not
    // check names". That is the right behaviour for a CBAM document: its names
    // are checked against the CBAM vocabulary below instead.
    knownFieldNames: cbamDocument ? new Set<string>() : knownFieldNames,
  })
  if (cbamDocument) {
    for (const field of parsed.data.fields) {
      if (!isCbamFieldName(field.fieldName) && !knownFieldNames.has(field.fieldName)) {
        fieldErrors.push({
          fieldName: field.fieldName,
          problem: 'unknown_field',
          message: 'This is not a field Arbor reads from this kind of document.',
        })
      }
    }
  }
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

  // Everything the reviewer confirmed, measurements and identifiers together.
  // The tier and the case are both decided from the effective document, so both
  // need the whole picture rather than the record-producing half of it.
  const confirmedValues = new Map<string, string>([
    ...(parsed.data.context ?? []).map(c => [c.fieldName, c.confirmedValue] as const),
    // Measured values win if a client sends a field in both lists, because
    // these are the ones that were validated and written.
    ...parsed.data.fields.map(f => [f.fieldName, f.confirmedValue] as const),
  ])

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
  let tierIsA: boolean
  if (cbamDocument) {
    tierIsA = Boolean(job) && cbamCompulsoryFieldsPresent(confirmedValues)
  } else {
    const entity = await prisma.entity.findUnique({
      where: { id: entityId },
      select: { legalName: true },
    })
    const periodEnds = parsed.data.fields.map(f => Date.parse(f.periodEnd)).filter(Number.isFinite)
    tierIsA = certifyTier({
      documentType: document.documentType,
      extracted: new Map((job?.extractedFields ?? []).map(f => [f.fieldName, f.rawValue])),
      confirmed: confirmedValues,
      hasExtraction: Boolean(job),
      entityName: entity?.legalName ?? '',
      reportingPeriodEnd: periodEnds.length ? new Date(Math.max(...periodEnds)) : undefined,
    }).tier === 'A'
  }

  const trustTier: TrustTier = tierIsA ? TrustTier.A : TrustTier.B

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
  //
  // Goods-line fields are excluded, because their names are positional.
  // `lines[0].net_mass_kg` on one customs declaration and `lines[0].net_mass_kg`
  // on the next are different goods that happen to have been listed first, so
  // comparing them answers nothing in either direction: it reports a duplicate
  // between two unrelated shipments, and choosing "replace" would supersede a
  // real consignment's records and remove it from every total. It would also
  // miss the case it is meant to catch, since the same goods can arrive at a
  // different index. A document can only be confirmed once, so within one
  // document there is nothing to duplicate either.
  const isPositional = (fieldName: string) =>
    cbamDocument && parseGoodsLineFieldName(fieldName) !== null

  const candidates = preparedFields
    .filter(({ field }) => !isPositional(field.fieldName))
    .map(({ field, periodStart, periodEnd }) => ({
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

  // The CBAM handoff is recorded inside the transaction below, so a confirmed
  // CBAM document can never exist without its handoff on record — and can be
  // resumed from that record if everything after the commit fails.
  const cbamHandoff = cbamDocument
    ? {
        documentId,
        entityId,
        documentType: document.documentType,
        jurisdiction: resolveJurisdiction(
          (await prisma.entity.findUnique({
            where: { id: entityId },
            select: { cbamJurisdiction: true },
          }))?.cbamJurisdiction,
        ),
        confirmed: confirmedValues,
        // Every prepared field shares the derived period, so the latest end is
        // the period the case covers.
        reportingPeriodEnd: preparedFields.reduce(
          (latest, f) => (f.periodEnd > latest ? f.periodEnd : latest),
          preparedFields[0].periodEnd,
        ),
      }
    : null

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
      //
      // A positional goods-line field supersedes nothing either, for the same
      // reason it is not a duplicate candidate: matching on `lines[0].*` would
      // retire another shipment's first goods line because this document also
      // has one.
      const prior = parsed.data.onDuplicate === 'keep_both' || isPositional(field.fieldName)
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

    if (cbamHandoff) await enqueueCbamHandoff(tx, cbamHandoff)

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

  // The CBAM handoff: a confirmed customs declaration, supplier invoice or CBAM
  // declaration becomes a case in Nucleos. Without this the CBAM screens read a
  // list nothing could fill — every case in them arrived by hand.
  //
  // Post-commit and never fatal. The records above are certified and chained;
  // a boundary that is down must not undo that. What it must not do either is
  // stay quiet, so the outcome travels back in the response and the failure is
  // written to the link row where the CBAM screens can show it.
  //
  // Run straight away, so the common case opens the case within this request.
  // A failure here leaves the row FAILED or PARTIAL with its progress recorded,
  // and Resume on the CBAM page — or the sweep — finishes it.
  let cbam: CbamHandoffOutcome | null = null
  if (cbamHandoff) {
    try {
      cbam = await runCbamHandoff(documentId)
    } catch (e) {
      console.error('[confirm] CBAM case handoff failed:', e)
      cbam = {
        attempted: true,
        caseId: null,
        status: 'PENDING',
        problems: ['The case has not been opened yet. Your figures are saved, and Arbor will retry.'],
      }
    }
  }

  return ok({
    recordIds: createdRecords,
    documentStatus: 'ACCEPTED',
    ...(cbam ? { cbam: { caseId: cbam.caseId, status: cbam.status, problems: cbam.problems } } : {}),
  })
}
