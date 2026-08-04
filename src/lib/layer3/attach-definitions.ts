// Layer 3 — read-only decoration. Pure: no DB, no network, no mutation.
//
// Trust tier already travels with every data point in every output (PRD §13,
// §21.2). The definition has to travel the same way. A buyer receiving
// "total_consumption_kwh = 480000 MJ" cannot use it responsibly without knowing
// what was counted, what was left out, and whether they ever agreed that wording
// — and a number whose meaning has to be looked up elsewhere is exactly the
// fragmented state the platform exists to end.
//
// The definition attached is the one in force when the record was SUBMITTED, not
// the one in force now. A record certified under v1 carries v1's boundary for the
// rest of its life; that is what makes the certification mean anything.

import {
  resolveDefinitionAsOf,
  type StoredFieldDefinition,
} from '@/lib/definitions/registry'
import {
  resolveAgreementFor,
  agreementLabel,
  type StoredAgreement,
  type AgreementState,
} from '@/lib/definitions/agreement'
import type { DataDomain } from '@/lib/constants'

/** The minimum a record must carry to be decorated. Extra fields pass through. */
export interface DecorableRecord {
  id: string
  entityId: string
  domain: DataDomain
  fieldName: string
  submittedAt: Date
  [key: string]: unknown
}

/** The definition snapshot that travels with the record. */
export interface AttachedDefinition {
  fieldDefinitionId: string
  version: number
  label: string
  definition: string
  boundary: string
  canonicalUnit: string | null
  sourceStandard: string | null
  effectiveFrom: Date
}

export interface AttachedAgreement {
  status: AgreementState
  label: string
  agreedVersion: number | null
  agreedAt: Date | null
}

export type RecordWithDefinition<T extends DecorableRecord> = T & {
  definition: AttachedDefinition | null
  agreement: AttachedAgreement
}

export interface AttachOptions {
  definitions: StoredFieldDefinition[]
  agreements: StoredAgreement[]
  /**
   * The entity receiving this output. null when a supplier is reading their own
   * data — there is no counterparty, so agreement is NOT_APPLICABLE rather than
   * a misleading "not agreed".
   */
  buyerEntityId: string | null
}

const NOT_APPLICABLE: AttachedAgreement = {
  status: 'NOT_APPLICABLE',
  label: agreementLabel('NOT_APPLICABLE'),
  agreedVersion: null,
  agreedAt: null,
}

/**
 * Decorate records with their governed definition and the agreement state for
 * the receiving buyer. Order is preserved, no record is dropped, and no stored
 * value is touched — Layer 3 translates and formats, nothing more.
 */
export function attachDefinitions<T extends DecorableRecord>(
  records: T[],
  { definitions, agreements, buyerEntityId }: AttachOptions,
): RecordWithDefinition<T>[] {
  return records.map(record => {
    const def = resolveDefinitionAsOf(definitions, {
      fieldName: record.fieldName,
      domain: record.domain,
      asOf: record.submittedAt,
    })

    if (!def) {
      return {
        ...record,
        definition: null,
        agreement:
          buyerEntityId === null
            ? NOT_APPLICABLE
            : { status: 'NONE', label: agreementLabel('NONE'), agreedVersion: null, agreedAt: null },
      }
    }

    const attached: AttachedDefinition = {
      fieldDefinitionId: def.id,
      version: def.version,
      label: def.label,
      definition: def.definition,
      boundary: def.boundary,
      canonicalUnit: def.canonicalUnit,
      sourceStandard: def.sourceStandard,
      effectiveFrom: def.effectiveFrom,
    }

    if (buyerEntityId === null) {
      return { ...record, definition: attached, agreement: NOT_APPLICABLE }
    }

    const resolved = resolveAgreementFor(agreements, {
      fieldDefinitionId: def.id,
      definitionVersion: def.version,
      supplierEntityId: record.entityId,
      buyerEntityId,
    })

    return {
      ...record,
      definition: attached,
      agreement: {
        status: resolved.status,
        label: agreementLabel(resolved.status),
        agreedVersion: resolved.agreedVersion,
        agreedAt: resolved.agreedAt,
      },
    }
  })
}
