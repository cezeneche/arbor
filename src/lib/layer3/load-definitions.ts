// Layer 3 — read-only. The impure companion to attachDefinitions: fetches the
// governed dictionary and the relevant agreements, then hands both to the pure
// decorator. Reads only; writes nothing, calculates nothing.
//
// The dictionary is small (one row per field+domain+version, tens of rows) and
// changes rarely, so it is loaded whole rather than joined per record. Agreements
// are scoped to the buyer and the suppliers actually in the result set.

import { prisma } from '@/lib/prisma'
import {
  attachDefinitions,
  type DecorableRecord,
  type RecordWithDefinition,
} from './attach-definitions'
import type { StoredFieldDefinition } from '@/lib/definitions/registry'
import type { StoredAgreement } from '@/lib/definitions/agreement'
import type { DataDomain } from '@/lib/constants'

function toStoredDefinition(row: {
  id: string
  fieldName: string
  domain: string
  version: number
  effectiveFrom: Date
  effectiveTo: Date | null
  label: string
  definition: string
  boundary: string
  canonicalUnit: string | null
  admissibility: string
  sourceStandard: string | null
}): StoredFieldDefinition {
  return {
    id: row.id,
    fieldName: row.fieldName,
    domain: row.domain as DataDomain,
    version: row.version,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    label: row.label,
    definition: row.definition,
    boundary: row.boundary,
    canonicalUnit: row.canonicalUnit,
    admissibility: row.admissibility as StoredFieldDefinition['admissibility'],
    sourceStandard: row.sourceStandard,
  }
}

/**
 * Decorate records with the definition in force when each was submitted, plus
 * the agreement state for `buyerEntityId`. Pass null for the buyer when a
 * supplier is reading their own data — there is no counterparty to agree with.
 */
export async function withDefinitions<T extends DecorableRecord>(
  records: T[],
  buyerEntityId: string | null,
): Promise<RecordWithDefinition<T>[]> {
  if (records.length === 0) return []

  const definitionRows = await prisma.fieldDefinition.findMany({
    orderBy: [{ fieldName: 'asc' }, { version: 'asc' }],
  })
  const definitions = definitionRows.map(toStoredDefinition)

  let agreements: StoredAgreement[] = []
  if (buyerEntityId) {
    const supplierIds = [...new Set(records.map(r => r.entityId))]
    const rows = await prisma.definitionAgreement.findMany({
      where: { buyerEntityId, supplierEntityId: { in: supplierIds } },
      select: {
        id: true,
        fieldDefinitionId: true,
        definitionVersion: true,
        supplierEntityId: true,
        buyerEntityId: true,
        status: true,
        proposedByEntityId: true,
        respondedAt: true,
        // The lineage the version number belongs to — without it, "did they agree
        // an earlier version" compares unrelated fields.
        fieldDefinition: { select: { fieldName: true, domain: true } },
      },
    })
    agreements = rows.map(({ fieldDefinition, ...r }) => ({
      ...r,
      fieldName: fieldDefinition.fieldName,
      domain: fieldDefinition.domain as string,
      status: r.status as StoredAgreement['status'],
    }))
  }

  return attachDefinitions(records, { definitions, agreements, buyerEntityId })
}
