// What an operator sees for one proposed match. Pure: the page loads the pair,
// this says how alike the names are and which identity details agree or
// conflict. A detail only one side has says nothing either way.

export interface MatchIdentity {
  legalName: string
  registrationNumber: string | null
  country: string | null
  sector: string | null
}

export interface MatchView {
  percent: number
  agreements: string[]
  conflicts: string[]
}

const DETAILS: { key: keyof Omit<MatchIdentity, 'legalName'>; same: string; different: string }[] = [
  {
    key: 'registrationNumber',
    same: 'Same registration number',
    different: 'Different registration numbers',
  },
  { key: 'country', same: 'Same country', different: 'Different countries' },
  { key: 'sector', same: 'Same sector', different: 'Different sectors' },
]

function comparable(value: string | null): string | null {
  const v = value?.replace(/\s+/g, '').toUpperCase()
  return v ? v : null
}

export function describeMatch(input: {
  similarity: number
  entityA: MatchIdentity
  entityB: MatchIdentity
}): MatchView {
  const agreements: string[] = []
  const conflicts: string[] = []
  for (const detail of DETAILS) {
    const a = comparable(input.entityA[detail.key])
    const b = comparable(input.entityB[detail.key])
    if (a === null || b === null) continue
    if (a === b) agreements.push(detail.same)
    else conflicts.push(detail.different)
  }
  return { percent: Math.round(input.similarity * 100), agreements, conflicts }
}
