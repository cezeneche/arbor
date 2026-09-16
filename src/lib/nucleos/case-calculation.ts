// Reading a case back and asking the engine what it declares.
//
// The wire the emissions view sits on. Everything it composes is elsewhere and
// tested there — reading the case, mapping it to a declaration, calling the
// engine, presenting the result — so what is left here is the sequence and the
// two things only this layer knows: whose case it is, and how well evidenced
// Arbor's records behind it are.
//
// Layer 3. It reads Arbor's database and Nucleos's, transforms, and writes
// nothing. The calculation itself happens in Nucleos, which is the point: Arbor
// holds the operational data and the engine computes from it.

import { prisma } from '@/lib/prisma'
import { getCbamCase } from './cases-client'
import { buildDeclarationPayload, toProvenanceTier, type CaseGoodsLine } from './declaration-payload'
import { calculateDeclaration } from './calculate-client'
import { presentCalculation, type PresentedCalculation } from './emissions-presenter'
import { calculationRegimes, resolveJurisdiction } from './jurisdiction'
import type { ContractJurisdiction } from './jurisdiction'
import type { ProvenanceTier } from './contract'

export interface RegimeCalculation {
  regime: ContractJurisdiction
  /** Null when this regime's calculation could not be completed. */
  presented: PresentedCalculation | null
  /** Why it could not be, or what was left out. Never empty on a null result. */
  problems: string[]
}

export interface CaseCalculation {
  caseId: string
  results: RegimeCalculation[]
  /** True when the case is not this entity's to read. */
  forbidden: boolean
  /** Set when the case itself could not be read. */
  loadError: string | null
}

/**
 * Whose case this is, and what Arbor's records behind it are worth.
 *
 * A case with no link row predates the handoff — there is no Arbor document
 * behind it, so there is no evidence to claim and the honest floor is Declared.
 * Ownership is only enforced where a link exists, for the same reason: refusing
 * every unlinked case would take the existing screens down.
 */
export async function caseContext(caseId: string, entityId: string): Promise<{
  forbidden: boolean
  provenance: ProvenanceTier
}> {
  const link = await prisma.cbamCaseLink.findFirst({
    where: { nucleosCaseId: caseId },
    select: { entityId: true, documentId: true },
  })
  if (!link) return { forbidden: false, provenance: 'DECLARED' }
  if (link.entityId !== entityId) return { forbidden: true, provenance: 'DECLARED' }

  // Every record from one confirmation shares one derived tier, so the first
  // active record for the document is the tier of all of them.
  const record = await prisma.dataRecord.findFirst({
    where: { documentId: link.documentId, isActive: true },
    select: { trustTier: true },
  })
  return { forbidden: false, provenance: toProvenanceTier(record?.trustTier ?? null) }
}

export async function calculateCase(
  caseId: string,
  entityId: string,
): Promise<CaseCalculation> {
  const { forbidden, provenance } = await caseContext(caseId, entityId)
  if (forbidden) {
    return { caseId, results: [], forbidden: true, loadError: null }
  }

  let record: Record<string, unknown>
  try {
    record = await getCbamCase(caseId)
  } catch (err) {
    return { caseId, results: [], forbidden: false, loadError: (err as Error).message }
  }

  const goodsLines = (record.goods_lines as CaseGoodsLine[] | undefined) ?? []
  const reportingYear = Number(record.reporting_year) || new Date().getUTCFullYear()
  const reportingQuarter =
    record.reporting_quarter === null || record.reporting_quarter === undefined
      ? null
      : Number(record.reporting_quarter)

  // The case's own jurisdiction, not the entity's current setting: a case filed
  // under one regime does not change regime because a preference was edited.
  const regimes = calculationRegimes(resolveJurisdiction(record.jurisdiction))

  const results: RegimeCalculation[] = []
  for (const regime of regimes) {
    const { payload, problems } = buildDeclarationPayload({
      caseReference: caseId,
      entityId,
      jurisdiction: regime,
      reportingYear,
      reportingQuarter,
      goodsLines,
      provenanceTier: provenance,
    })

    if (!payload) {
      results.push({ regime, presented: null, problems })
      continue
    }

    try {
      const calculated = await calculateDeclaration(payload)
      results.push({ regime, presented: presentCalculation(calculated), problems })
    } catch (err) {
      // Fails closed, and says so. A screen that showed nothing here would be
      // indistinguishable from a case that genuinely declares nothing.
      results.push({
        regime,
        presented: null,
        problems: [
          ...problems,
          `The emissions for this case could not be calculated: ${(err as Error).message}`,
        ],
      })
    }
  }

  return { caseId, results, forbidden: false, loadError: null }
}
