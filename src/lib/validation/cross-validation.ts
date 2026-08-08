// crossValidate is Layer 2 (pure function  -  no DB reads, no side effects).
// runCrossValidation is Layer 1 (reads DB, raises flags).

import { prisma } from '@/lib/prisma'
import { stampFlagOwnership } from '@/lib/stewardship/route-flags'

/** How two figures are meant to relate.
 *
 *  AGREE is the ordinary case: they describe the same quantity and should match
 *  within a tolerance. B_MUST_NOT_EXCEED_A is a ceiling, not an agreement — a
 *  renewable certificate may cover less consumption than was metered, and usually
 *  does; what it must never do is cover more. Expressing that as AGREE with a zero
 *  tolerance made any certificate below consumption fail, which is the normal,
 *  correct state of affairs. */
export type CrossValidationComparison = 'AGREE' | 'B_MUST_NOT_EXCEED_A'

export interface CrossValidationInput {
  entityId: string
  documentAId: string
  documentBId: string
  fieldName: string
  valueA: number
  valueB: number
  tolerancePercent: number
  comparison?: CrossValidationComparison
}

export interface CrossValidationOutput {
  passed: boolean
  discrepancyPercent: number
  message: string
}

export function crossValidate(input: CrossValidationInput): CrossValidationOutput {
  const comparison = input.comparison ?? 'AGREE'

  const reference = Math.max(Math.abs(input.valueA), Math.abs(input.valueB))
  const discrepancyPercent =
    reference === 0 ? 0 : (Math.abs(input.valueA - input.valueB) / reference) * 100

  if (comparison === 'B_MUST_NOT_EXCEED_A') {
    // Only the overshoot matters, and only beyond the tolerance.
    const overshootPercent =
      reference === 0 ? 0 : (Math.max(0, input.valueB - input.valueA) / reference) * 100
    const passed = overshootPercent <= input.tolerancePercent
    return {
      passed,
      discrepancyPercent: overshootPercent,
      message: passed
        ? `Within limit: ${input.valueB} does not exceed ${input.valueA}.`
        : `${input.valueB} exceeds ${input.valueA} by ${overshootPercent.toFixed(2)}%. This figure cannot be larger than the one it is claimed against.`,
    }
  }

  if (input.valueA === 0 && input.valueB === 0) {
    return { passed: true, discrepancyPercent: 0, message: 'Both values are zero  -  consistent.' }
  }

  const passed = discrepancyPercent <= input.tolerancePercent

  return {
    passed,
    discrepancyPercent,
    message: passed
      ? `Values consistent within ${input.tolerancePercent}% tolerance (${discrepancyPercent.toFixed(2)}% discrepancy).`
      : `Discrepancy of ${discrepancyPercent.toFixed(2)}% exceeds ${input.tolerancePercent}% tolerance. A: ${input.valueA}, B: ${input.valueB}.`,
  }
}

/** Two records describe the same activity only if the periods they cover overlap.
 *  Comparing a Q1 freight invoice with a Q4 delivery note produces a discrepancy
 *  that is not a discrepancy, and buries the real ones. */
export function periodsOverlap(
  a: { periodStart: Date; periodEnd: Date },
  b: { periodStart: Date; periodEnd: Date },
): boolean {
  return a.periodStart <= b.periodEnd && b.periodStart <= a.periodEnd
}

/** Values are only comparable in the same unit. Records are normalised to SI at
 *  write time, so this should hold — where it does not, the honest answer is to
 *  compare nothing rather than to compare numbers that mean different things. */
export function unitsComparable(unitA: string, unitB: string): boolean {
  return unitA.trim().toLowerCase() === unitB.trim().toLowerCase()
}

export const CROSS_VALIDATION_RULES = [
  {
    docTypeA: 'FREIGHT_INVOICE',
    docTypeB: 'DELIVERY_NOTE',
    fieldA: 'shipment_weight',
    fieldB: 'total_quantity',
    tolerancePercent: 2,
    description: 'Freight invoice weight vs delivery note quantity',
  },
  {
    docTypeA: 'FREIGHT_INVOICE',
    docTypeB: 'CUSTOMS_DECLARATION',
    fieldA: 'shipment_weight',
    fieldB: 'declared_weight',
    tolerancePercent: 2,
    description: 'Freight invoice weight vs customs declared weight',
  },
  {
    docTypeA: 'SUPPLIER_INVOICE',
    docTypeB: 'DELIVERY_NOTE',
    fieldA: 'total_quantity',
    fieldB: 'total_quantity',
    tolerancePercent: 1,
    description: 'Invoice quantity vs delivery note quantity',
  },
  {
    docTypeA: 'SUPPLIER_INVOICE',
    docTypeB: 'PURCHASE_ORDER',
    fieldA: 'total_quantity',
    fieldB: 'total_quantity',
    tolerancePercent: 5,
    description: 'Invoice quantity vs PO quantity',
  },
  {
    docTypeA: 'ELECTRICITY_BILL',
    docTypeB: 'RENEWABLE_CERTIFICATE',
    fieldA: 'total_consumption_kwh',
    fieldB: 'quantity_mwh',
    tolerancePercent: 0,
    // A ceiling, not an agreement: certificates covering less than the metered
    // consumption are the normal case. Only an overshoot is a finding.
    comparison: 'B_MUST_NOT_EXCEED_A' as const,
    description: 'REGO quantity must not exceed metered consumption',
  },
  // §3.2 Delivery Note cross-validations per admissibility spec
  {
    docTypeA: 'DELIVERY_NOTE',
    docTypeB: 'MATERIAL_INTAKE',
    fieldA: 'total_quantity',
    fieldB: 'quantity',
    tolerancePercent: 2,
    description: 'Delivery note quantity vs material intake received quantity',
  },
  // §3.3 Customs Declaration cross-validations per admissibility spec
  {
    docTypeA: 'CUSTOMS_DECLARATION',
    docTypeB: 'SUPPLIER_INVOICE',
    fieldA: 'declared_weight',
    fieldB: 'total_quantity',
    tolerancePercent: 5,
    description: 'Customs declared weight vs supplier invoice quantity',
  },
  // §2.4 Process Data Sheet cross-validations per admissibility spec
  {
    docTypeA: 'PROCESS_DATA_SHEET',
    docTypeB: 'ELECTRICITY_BILL',
    fieldA: 'energy_consumption',
    fieldB: 'total_consumption_kwh',
    tolerancePercent: 5,
    description: 'Process data sheet energy consumption vs electricity bill metered consumption',
  },
  {
    docTypeA: 'PROCESS_DATA_SHEET',
    docTypeB: 'MATERIAL_INTAKE',
    fieldA: 'total_input_quantity',
    fieldB: 'quantity',
    tolerancePercent: 10,
    description: 'Process data sheet inputs vs material intake received quantity',
  },
  // §2.2 Material Intake cross-validations per admissibility spec
  {
    docTypeA: 'MATERIAL_INTAKE',
    docTypeB: 'SUPPLIER_INVOICE',
    fieldA: 'quantity',
    fieldB: 'total_quantity',
    tolerancePercent: 2,
    description: 'Material intake quantity vs supplier invoice quantity',
  },
  {
    docTypeA: 'MATERIAL_INTAKE',
    docTypeB: 'PRODUCTION_LOG',
    fieldA: 'quantity',
    fieldB: 'total_input_quantity',
    tolerancePercent: 10,
    description: 'Material intake received vs production log material consumption',
  },
]

export async function runCrossValidation(
  entityId: string,
  newDocumentId: string,
  newDocumentType: string,
): Promise<void> {
  const applicable = CROSS_VALIDATION_RULES.filter(
    (r) => r.docTypeA === newDocumentType || r.docTypeB === newDocumentType,
  )

  for (const rule of applicable) {
    const counterpartType =
      rule.docTypeA === newDocumentType ? rule.docTypeB : rule.docTypeA
    const counterpartField =
      rule.docTypeA === newDocumentType ? rule.fieldB : rule.fieldA
    const thisField =
      rule.docTypeA === newDocumentType ? rule.fieldA : rule.fieldB

    const counterpartDocs = await prisma.document.findMany({
      where: { entityId, documentType: counterpartType as never, status: 'ACCEPTED' },
      include: {
        dataRecords: { where: { fieldName: counterpartField, isActive: true } },
      },
    })

    const thisDoc = await prisma.document.findUnique({
      where: { id: newDocumentId },
      include: {
        dataRecords: { where: { fieldName: thisField, isActive: true } },
      },
    })

    if (!thisDoc || thisDoc.dataRecords.length === 0) continue

    for (const counterpart of counterpartDocs) {
      if (counterpart.id === newDocumentId) continue

      for (const recordB of counterpart.dataRecords) {
        for (const recordA of thisDoc.dataRecords) {
          // Only records covering the same stretch of time describe the same
          // activity. Every accepted counterpart used to be compared regardless of
          // period, so a Q1 invoice was checked against a Q4 delivery note and the
          // resulting "discrepancy" buried the real ones.
          if (!periodsOverlap(recordA, recordB)) continue

          // Records are normalised to SI at write time, so a unit mismatch here
          // means the two figures are not the same kind of quantity. Comparing
          // them would produce a number that means nothing.
          if (!unitsComparable(recordA.unit, recordB.unit)) continue

          // A rule is directional: valueA is always the rule's docTypeA side, so
          // "B must not exceed A" keeps its meaning whichever document arrived last.
          const thisIsA = rule.docTypeA === newDocumentType
          const valueA = thisIsA ? recordA.value : recordB.value
          const valueB = thisIsA ? recordB.value : recordA.value

          const result = crossValidate({
            entityId,
            documentAId: newDocumentId,
            documentBId: counterpart.id,
            fieldName: thisField,
            valueA,
            valueB,
            tolerancePercent: rule.tolerancePercent,
            comparison: 'comparison' in rule ? rule.comparison : 'AGREE',
          })

          // Re-running cross-validation (a re-confirmation, a retry, a backfill)
          // used to add another row and another pair of flags every time. The
          // record pair identifies the comparison, so the same comparison updates
          // in place instead of accumulating.
          await prisma.crossValidationResult.upsert({
            where: {
              documentAId_documentBId_fieldName_recordAId_recordBId: {
                documentAId: newDocumentId,
                documentBId: counterpart.id,
                fieldName: thisField,
                recordAId: recordA.id,
                recordBId: recordB.id,
              },
            },
            create: {
              entityId,
              documentAId: newDocumentId,
              documentBId: counterpart.id,
              recordAId: recordA.id,
              recordBId: recordB.id,
              fieldName: thisField,
              valueA,
              valueB,
              tolerancePercent: rule.tolerancePercent,
              discrepancyPercent: result.discrepancyPercent,
              passed: result.passed,
            },
            update: {
              valueA,
              valueB,
              tolerancePercent: rule.tolerancePercent,
              discrepancyPercent: result.discrepancyPercent,
              passed: result.passed,
            },
          })

          if (!result.passed) {
            // Both sides of the discrepancy get an owner and a deadline, routed
            // by the domain each record sits in — the two records can belong to
            // different domains and therefore different stewards.
            //
            // A record that already carries an unresolved flag for this comparison
            // does not get a second one; the same finding raised twice is noise
            // that pushes the real backlog out of sight.
            const alreadyFlagged = await prisma.validationFlag.findMany({
              where: {
                dataRecordId: { in: [recordA.id, recordB.id] },
                flagType: 'CROSS_DOC_DISCREPANCY',
                resolvedAt: null,
                message: result.message,
              },
              select: { dataRecordId: true },
            })
            const flaggedIds = new Set(alreadyFlagged.map(f => f.dataRecordId))

            const pending = [recordA.id, recordB.id]
              .filter(id => !flaggedIds.has(id))
              .map(dataRecordId => ({
                dataRecordId,
                flagType: 'CROSS_DOC_DISCREPANCY' as const,
                message: result.message,
                severity: 'WARNING' as const,
              }))

            if (pending.length > 0) {
              const owned = await stampFlagOwnership(pending, entityId)
              await prisma.validationFlag.createMany({ data: owned })
            }
          }
        }
      }
    }
  }
}
