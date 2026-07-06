// Upgrade 3 — intake flagging (Layer 1: reads DB, raises flags). Runs after a
// document is confirmed and its records are written. Groups the document's
// stored records, asks the brain whether they satisfy the algebraic constraints
// (mass balance, non-negativity, plausible sector intensity), and raises any
// violation as a non-blocking ValidationFlag for human review.
//
// This is the "reject the physically impossible / surface fraud" signal the
// rule-based admissibility spec cannot see. It is deliberately OFF the write-path
// critical section: it runs post-commit and is fail-soft — if the brain is down
// or errors, no flags are written and the confirmation still stands. The brain
// must never block ingestion.

import { prisma } from '@/lib/prisma'
import { groupRecordsByDocument, type RecordRow } from './group-records'
import { planConstraintFlags, type RecordRef, type PlannedFlag } from './plan-flags'
import { checkConstraints } from '@/lib/brain/constraints-client'
import { BrainUnavailableError } from '@/lib/brain/calibration-client'

/**
 * Check a document's stored records against the algebraic constraints and write a
 * ValidationFlag for each violation. Returns the flags written (empty on a clean
 * document, and — fail-soft — empty whenever the brain is unavailable) so callers
 * such as the auto-accept gate can react to whether any physics violation was found.
 */
export async function runConstraintValidation(documentId: string): Promise<PlannedFlag[]> {
  const records = await prisma.dataRecord.findMany({
    where: { documentId, isActive: true },
    select: {
      id: true,
      fieldName: true,
      value: true,
      entity: { select: { sector: true } },
    },
  })

  if (records.length === 0) return []

  const rows: RecordRow[] = records.map((r) => ({
    documentId,
    fieldName: r.fieldName,
    value: r.value,
    sector: r.entity?.sector ?? null,
  }))
  const refs: RecordRef[] = records.map((r) => ({
    documentId,
    fieldName: r.fieldName,
    dataRecordId: r.id,
  }))

  const inputs = groupRecordsByDocument(rows)
  if (inputs.length === 0) return []

  let results
  try {
    results = await checkConstraints(inputs)
  } catch (e) {
    // Fail-soft: brain down or errored → no flags, confirmation still stands.
    if (e instanceof BrainUnavailableError) return []
    throw e
  }

  const flags = planConstraintFlags(results, refs)
  if (flags.length === 0) return []

  await prisma.validationFlag.createMany({ data: flags })
  return flags
}
