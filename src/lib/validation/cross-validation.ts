// crossValidate is Layer 2 (pure function — no DB reads, no side effects).
// runCrossValidation is Layer 1 (reads DB, raises flags).

import { prisma } from '@/lib/prisma'

export interface CrossValidationInput {
  entityId: string
  documentAId: string
  documentBId: string
  fieldName: string
  valueA: number
  valueB: number
  tolerancePercent: number
}

export interface CrossValidationOutput {
  passed: boolean
  discrepancyPercent: number
  message: string
}

export function crossValidate(input: CrossValidationInput): CrossValidationOutput {
  if (input.valueA === 0 && input.valueB === 0) {
    return { passed: true, discrepancyPercent: 0, message: 'Both values are zero — consistent.' }
  }

  const reference = Math.max(Math.abs(input.valueA), Math.abs(input.valueB))
  const discrepancyPercent =
    reference === 0 ? 0 : (Math.abs(input.valueA - input.valueB) / reference) * 100
  const passed = discrepancyPercent <= input.tolerancePercent

  return {
    passed,
    discrepancyPercent,
    message: passed
      ? `Values consistent within ${input.tolerancePercent}% tolerance (${discrepancyPercent.toFixed(2)}% discrepancy).`
      : `Discrepancy of ${discrepancyPercent.toFixed(2)}% exceeds ${input.tolerancePercent}% tolerance. A: ${input.valueA}, B: ${input.valueB}.`,
  }
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
    fieldB: 'quantity_mwh_in_kwh',
    tolerancePercent: 0,
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
      for (const recordB of counterpart.dataRecords) {
        for (const recordA of thisDoc.dataRecords) {
          const result = crossValidate({
            entityId,
            documentAId: newDocumentId,
            documentBId: counterpart.id,
            fieldName: thisField,
            valueA: recordA.value,
            valueB: recordB.value,
            tolerancePercent: rule.tolerancePercent,
          })

          await prisma.crossValidationResult.create({
            data: {
              entityId,
              documentAId: newDocumentId,
              documentBId: counterpart.id,
              fieldName: thisField,
              valueA: recordA.value,
              valueB: recordB.value,
              tolerancePercent: rule.tolerancePercent,
              discrepancyPercent: result.discrepancyPercent,
              passed: result.passed,
            },
          })

          if (!result.passed) {
            await prisma.validationFlag.createMany({
              data: [
                {
                  dataRecordId: recordA.id,
                  flagType: 'CROSS_DOC_DISCREPANCY',
                  message: result.message,
                  severity: 'WARNING',
                },
                {
                  dataRecordId: recordB.id,
                  flagType: 'CROSS_DOC_DISCREPANCY',
                  message: result.message,
                  severity: 'WARNING',
                },
              ],
            })
          }
        }
      }
    }
  }
}
