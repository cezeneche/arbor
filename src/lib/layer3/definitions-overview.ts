// Layer 3 — read-only. The dictionary as one entity sees it: the wording in force,
// and where each counterparty stands on it. Shared by the /definitions page and
// the /api/definitions route so the two can never drift.

import { prisma } from '@/lib/prisma'
import { currentDefinitions, type StoredFieldDefinition } from '@/lib/definitions/registry'
import {
  resolveAgreementFor,
  agreementLabel,
  type StoredAgreement,
  type AgreementState,
} from '@/lib/definitions/agreement'
import { DOMAIN_LABELS } from '@/lib/domain-labels'
import type { DataDomain } from '@/lib/constants'

export interface CounterpartyAgreement {
  agreementId: string
  counterpartyName: string
  counterpartyEntityId: string
  /** Which side this entity is on for that relationship. */
  weAreThe: 'supplier' | 'buyer'
  status: AgreementState
  statusLabel: string
  agreedVersion: number | null
  /** True when the ball is in this entity's court. Drives the primary action. */
  awaitingUs: boolean
  note: string | null
  proposedAt: Date
}

export interface DefinitionOverviewRow {
  id: string
  fieldName: string
  domain: string
  domainLabel: string
  version: number
  effectiveFrom: Date
  label: string
  definition: string
  boundary: string
  canonicalUnit: string | null
  sourceStandard: string | null
  counterparties: CounterpartyAgreement[]
}

export interface DefinitionsOverview {
  asOf: Date
  definitions: DefinitionOverviewRow[]
  /** How many proposals this entity has been asked to answer. */
  awaitingYou: number
  /** Companies this entity shares data with — the valid targets for a proposal. */
  counterparties: { entityId: string; legalName: string }[]
}

export async function loadDefinitionsOverview(
  entityId: string,
  asOf: Date = new Date(),
): Promise<DefinitionsOverview> {
  const [rows, agreementRows, grants] = await Promise.all([
    prisma.fieldDefinition.findMany({
      orderBy: [{ domain: 'asc' }, { fieldName: 'asc' }, { version: 'asc' }],
    }),
    prisma.definitionAgreement.findMany({
      where: { OR: [{ supplierEntityId: entityId }, { buyerEntityId: entityId }] },
      select: {
        id: true,
        fieldDefinitionId: true,
        definitionVersion: true,
        supplierEntityId: true,
        buyerEntityId: true,
        status: true,
        proposedByEntityId: true,
        proposedAt: true,
        respondedAt: true,
        note: true,
        supplierEntity: { select: { legalName: true } },
        buyerEntity: { select: { legalName: true } },
      },
    }),
    prisma.dataAccessGrant.findMany({
      where: {
        isActive: true,
        revokedAt: null,
        OR: [{ grantorEntityId: entityId }, { granteeEntityId: entityId }],
      },
      select: {
        grantorEntityId: true,
        granteeEntityId: true,
        grantorEntity: { select: { legalName: true } },
        granteeEntity: { select: { legalName: true } },
      },
    }),
  ])

  const stored: StoredFieldDefinition[] = rows.map(r => ({
    ...r,
    domain: r.domain as DataDomain,
    admissibility: r.admissibility as StoredFieldDefinition['admissibility'],
  }))
  const inForce = currentDefinitions(stored, asOf)

  const agreements: StoredAgreement[] = agreementRows.map(a => ({
    id: a.id,
    fieldDefinitionId: a.fieldDefinitionId,
    definitionVersion: a.definitionVersion,
    supplierEntityId: a.supplierEntityId,
    buyerEntityId: a.buyerEntityId,
    status: a.status as StoredAgreement['status'],
    proposedByEntityId: a.proposedByEntityId,
    respondedAt: a.respondedAt,
  }))

  const definitions: DefinitionOverviewRow[] = inForce
    .map(def => {
      // One row per counterparty: "agreed with A, still waiting on B" must be
      // visible rather than collapsed into one misleading status.
      const counterparties: CounterpartyAgreement[] = agreementRows
        .filter(a => a.fieldDefinitionId === def.id)
        .map(a => {
          const weAreSupplier = a.supplierEntityId === entityId
          const resolved = resolveAgreementFor(agreements, {
            fieldDefinitionId: def.id,
            definitionVersion: def.version,
            supplierEntityId: a.supplierEntityId,
            buyerEntityId: a.buyerEntityId,
          })
          return {
            agreementId: a.id,
            counterpartyName: weAreSupplier ? a.buyerEntity.legalName : a.supplierEntity.legalName,
            counterpartyEntityId: weAreSupplier ? a.buyerEntityId : a.supplierEntityId,
            weAreThe: weAreSupplier ? ('supplier' as const) : ('buyer' as const),
            status: resolved.status,
            statusLabel: agreementLabel(resolved.status),
            agreedVersion: resolved.agreedVersion,
            awaitingUs: a.status === 'PROPOSED' && a.proposedByEntityId !== entityId,
            note: a.note,
            proposedAt: a.proposedAt,
          }
        })
        .sort((a, b) => Number(b.awaitingUs) - Number(a.awaitingUs) || a.counterpartyName.localeCompare(b.counterpartyName))

      return {
        id: def.id,
        fieldName: def.fieldName,
        domain: def.domain,
        domainLabel: DOMAIN_LABELS[def.domain] ?? def.domain,
        version: def.version,
        effectiveFrom: def.effectiveFrom,
        label: def.label,
        definition: def.definition,
        boundary: def.boundary,
        canonicalUnit: def.canonicalUnit,
        sourceStandard: def.sourceStandard,
        counterparties,
      }
    })
    .sort(
      (a, b) =>
        // Anything needing an answer floats to the top — the screen's one action.
        Number(b.counterparties.some(c => c.awaitingUs)) -
          Number(a.counterparties.some(c => c.awaitingUs)) ||
        a.domainLabel.localeCompare(b.domainLabel) ||
        a.label.localeCompare(b.label),
    )

  const counterpartyMap = new Map<string, string>()
  for (const g of grants) {
    if (g.grantorEntityId !== entityId) counterpartyMap.set(g.grantorEntityId, g.grantorEntity.legalName)
    if (g.granteeEntityId !== entityId) counterpartyMap.set(g.granteeEntityId, g.granteeEntity.legalName)
  }

  return {
    asOf,
    definitions,
    awaitingYou: definitions.reduce(
      (n, d) => n + d.counterparties.filter(c => c.awaitingUs).length,
      0,
    ),
    counterparties: [...counterpartyMap.entries()]
      .map(([entityId, legalName]) => ({ entityId, legalName }))
      .sort((a, b) => a.legalName.localeCompare(b.legalName)),
  }
}
