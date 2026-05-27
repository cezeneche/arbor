// Layer 3 — packaging only. No calculation logic. Translation of existing records.
// [EU Regulation 2023/1773 Art. 4(1)] CBAM quarterly return — HMRC-required format (UK)
// Trust tier travels with every declaration.

export interface CbamDeclaration {
  id: string
  declarationReference: string
  commodityCode: string
  commodityDescription: string
  countryOfOrigin: string
  importerName: string
  declarantName: string
  declaredWeight: number
  embeddedEmissionsKgCo2e: number
  calculationTier: string
  trustTier: 'A' | 'B' | 'C'
  periodStart: Date
  periodEnd: Date
}

export interface CbamInput {
  entityName: string
  entityId: string
  quarter: string
  year: number
  declarations: CbamDeclaration[]
}

export interface CbamReturnDeclaration extends CbamDeclaration {
  requiresVerification: boolean
}

export interface CbamUkReturn {
  entityName: string
  entityId: string
  quarter: string
  year: number
  regulatoryReference: string
  totalEmbeddedEmissionsKgCo2e: number
  declarations: CbamReturnDeclaration[]
}

// [EU 2023/1773 Art. 4(1)] buildCbamUkReturn — quarterly CBAM return in HMRC-required format
export function buildCbamUkReturn(input: CbamInput): CbamUkReturn {
  const totalEmbeddedEmissionsKgCo2e = input.declarations.reduce(
    (sum, d) => sum + d.embeddedEmissionsKgCo2e,
    0,
  )

  const declarations: CbamReturnDeclaration[] = input.declarations.map((d) => ({
    ...d,
    requiresVerification: d.trustTier !== 'A',
  }))

  return {
    entityName: input.entityName,
    entityId: input.entityId,
    quarter: input.quarter,
    year: input.year,
    regulatoryReference: 'EU Regulation 2023/1773, Art. 4(1) — CBAM Quarterly Return',
    totalEmbeddedEmissionsKgCo2e,
    declarations,
  }
}
