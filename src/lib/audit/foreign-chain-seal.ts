// Recording a foreign chain's final state.
//
// Phase 4 made Arbor's chain the only one accepting writes. The Nucleos CBAM
// chain was not imported — none of its entries backed a filed declaration or was
// shown to a supplier or auditor, and its cases were sample data, so attaching
// them to real entities would have meant guessing which company each belonged
// to, in the one part of the product whose purpose is knowing exactly that.
//
// Not importing is not the same as pretending the chain never existed. A chain
// that stops with no record of where it stopped is indistinguishable from one
// that was truncated, and "entries are missing" is the single accusation this
// system is built to be able to answer. So its final state is committed here,
// as the origin marker of Arbor's own chain.

import { prisma } from '@/lib/prisma'

export interface ForeignChainSealInput {
  origin: string
  algorithm: string
  entryCount: number
  firstEventAt: string | null
  lastEventAt: string | null
  finalSignature: string | null
  sealHash: string
  sealedAt: string
  importedIntoArbor: boolean
  reason: string
}

export class ChainAlreadySealedError extends Error {
  constructor(origin: string) {
    super(
      `Chain "${origin}" is already sealed. A chain ends once — re-sealing would ` +
        `either mean it accepted writes after being sealed, which contradicts the ` +
        `seal, or that this is a duplicate import.`,
    )
    this.name = 'ChainAlreadySealedError'
  }
}

function parseDate(value: string | null): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Record a sealed foreign chain. Idempotent by origin, and refuses to overwrite.
 *
 * Overwriting would let a second seal quietly replace the first, which is the
 * one operation that could hide a chain having continued after it was declared
 * closed.
 */
export async function recordForeignChainSeal(input: ForeignChainSealInput) {
  const existing = await prisma.foreignChainSeal.findUnique({
    where: { origin: input.origin },
  })

  if (existing) {
    if (existing.sealHash === input.sealHash) return existing
    throw new ChainAlreadySealedError(input.origin)
  }

  const sealedAt = parseDate(input.sealedAt)
  if (!sealedAt) {
    throw new Error(`Seal for "${input.origin}" has no valid sealedAt timestamp.`)
  }

  return prisma.foreignChainSeal.create({
    data: {
      origin: input.origin,
      algorithm: input.algorithm,
      entryCount: input.entryCount,
      firstEventAt: parseDate(input.firstEventAt),
      lastEventAt: parseDate(input.lastEventAt),
      finalSignature: input.finalSignature,
      sealHash: input.sealHash,
      sealedAt,
      importedIntoArbor: input.importedIntoArbor,
      reason: input.reason,
    },
  })
}

/**
 * Every sealed chain, for the audit package.
 *
 * An audit package that showed Arbor's chain alone would present it as though it
 * began from nothing. These are what say otherwise.
 */
export async function listForeignChainSeals() {
  return prisma.foreignChainSeal.findMany({ orderBy: { sealedAt: 'asc' } })
}

export const NUCLEOS_SEAL_REASON =
  'Sealed at Phase 4 of the Nucleos integration and deliberately not imported. ' +
  'No entry backed a filed declaration or was shown to a supplier or auditor, and ' +
  'the cases were sample data, so mapping them onto real entities would have ' +
  'required guessing which company each belonged to. The chain is recorded here ' +
  'so that it ending is itself auditable.'
