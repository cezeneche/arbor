// Which kind of data a supplier request is asking for.
//
// The two are not variants of one flow. They ask different questions, carry
// different contracts, and what comes back is stored in different places:
//
//   RECORDS — "share the operational data you already hold." The answer becomes
//   certified Arbor records with a provenance tier, assembled from documents the
//   supplier uploads. Arbor's DataRequest.
//
//   CBAM — "tell us the emissions intensity of these specific goods." The answer
//   is one number in tCO2e per tonne, which is multiplied into a mass-weighted
//   total against a goods line. Nucleos's three-field submission contract.
//
// Asking the user which they mean, rather than inferring it, is deliberate. The
// wrong guess sends a supplier a form they cannot answer — a records request to
// someone who has never seen an Arbor document, or a CBAM intensity form to
// someone who was asked for last quarter's electricity bills. Either way the
// request goes unanswered and nobody finds out why.

export type RequestKind = 'records' | 'cbam'

export interface RequestKindOption {
  id: RequestKind
  label: string
  /** What the supplier is actually asked for. */
  asks: string
  /** Where the answer ends up, in plain English. */
  produces: string
  href: string
}

export const REQUEST_KINDS: RequestKindOption[] = [
  {
    id: 'records',
    label: 'Operational data',
    asks:
      'Ask a supplier to share operational data they already hold — energy, production, materials, logistics.',
    produces:
      'Their answer becomes certified records in your account, with the source documents behind them.',
    href: '/supply-chain/request',
  },
  {
    id: 'cbam',
    label: 'CBAM emissions data',
    asks:
      'Ask a supplier for the emissions intensity of specific goods, in tCO₂e per tonne.',
    produces:
      'Their answer attaches to a goods line in a CBAM case, and replaces the default value.',
    href: '/cbam?view=request',
  },
]

export function resolveRequestKind(raw: string | undefined | null): RequestKind | null {
  const match = REQUEST_KINDS.find(k => k.id === raw)
  return match ? match.id : null
}
