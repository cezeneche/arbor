// Layer 3 — packaging only. No calculation logic. Translation of existing records.
// [EU Commission Delegated Regulation 2023/2772 — ESRS E1 Climate Change disclosures]
// Trust tier travels with every mapped data point.

export interface CsrdDataRecord {
  id: string
  domain: string
  fieldName: string
  value: number
  unit: string
  trustTier: 'A' | 'B' | 'C'
  scope3Category: number | null
  periodStart: Date
  periodEnd: Date
}

export interface CsrdInput {
  entityName: string
  reportingYear: number
  dataRecords: CsrdDataRecord[]
}

export interface CsrdDataPoint {
  recordId: string
  domain: string
  fieldName: string
  value: number
  unit: string
  trustTier: 'A' | 'B' | 'C'
  isEstimated: boolean
  scope3Category: number | null
  periodStart: Date
  periodEnd: Date
}

export interface CsrdE1Disclosure {
  entityName: string
  reportingYear: number
  standard: 'ESRS E1'
  regulatoryReference: string
  dataPoints: CsrdDataPoint[]
}

// [EU 2023/2772 ESRS E1] buildCsrdE1Disclosure — maps DataRecords to ESRS E1 format.
// No computation performed here — values are taken directly from stored records.
export function buildCsrdE1Disclosure(input: CsrdInput): CsrdE1Disclosure {
  const dataPoints: CsrdDataPoint[] = input.dataRecords.map((record) => ({
    recordId: record.id,
    domain: record.domain,
    fieldName: record.fieldName,
    value: record.value,
    unit: record.unit,
    trustTier: record.trustTier,
    isEstimated: record.trustTier !== 'A',
    scope3Category: record.scope3Category,
    periodStart: record.periodStart,
    periodEnd: record.periodEnd,
  }))

  return {
    entityName: input.entityName,
    reportingYear: input.reportingYear,
    standard: 'ESRS E1',
    regulatoryReference: 'EU 2023/2772 Commission Delegated Regulation, ESRS E1 Climate Change',
    dataPoints,
  }
}
