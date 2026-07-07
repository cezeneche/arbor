// pure mappers from provider payloads to a normalised integration record.
// No DB, no network. The sync functions call these then write Tier B records.
import type { DataDomain } from '@/lib/constants'

export interface IntegrationRecord {
  domain: DataDomain
  fieldName: string
  value: number
  unit: string
  periodStart: Date
  periodEnd: Date
  sourceRef: string
}

function toDate(s: unknown): Date | null {
  if (typeof s !== 'string' || !s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

// HMRC CDS — customs declarations → LOGISTICS declared_weight.
export function mapCdsDeclarations(payload: {
  declarations?: Array<{ movementReferenceNumber?: string; declaredWeight?: number; weightUnit?: string; declarationDate?: string }>
}): IntegrationRecord[] {
  const out: IntegrationRecord[] = []
  for (const d of payload.declarations ?? []) {
    const date = toDate(d.declarationDate)
    if (!d.movementReferenceNumber || typeof d.declaredWeight !== 'number' || !date) continue
    out.push({
      domain: 'LOGISTICS',
      fieldName: 'declared_weight',
      value: d.declaredWeight,
      unit: d.weightUnit ?? 'kg',
      periodStart: date,
      periodEnd: date,
      sourceRef: d.movementReferenceNumber,
    })
  }
  return out
}

// SAP S/4HANA OData material documents → MATERIALS quantity.
export function mapSapMaterialDocs(payload: {
  d?: { results?: Array<{ MaterialDocument?: string; QuantityInEntryUnit?: string; EntryUnit?: string; PostingDate?: string }> }
}): IntegrationRecord[] {
  const out: IntegrationRecord[] = []
  for (const r of payload.d?.results ?? []) {
    const value = Number(r.QuantityInEntryUnit)
    const date = toDate(r.PostingDate)
    if (!r.MaterialDocument || !Number.isFinite(value) || value <= 0 || !date) continue
    out.push({
      domain: 'MATERIALS',
      fieldName: 'quantity',
      value,
      unit: r.EntryUnit ?? 'unit',
      periodStart: date,
      periodEnd: date,
      sourceRef: r.MaterialDocument,
    })
  }
  return out
}

// NetSuite SuiteTalk item receipts → MATERIALS quantity.
export function mapNetSuiteItemReceipts(payload: {
  items?: Array<{ id?: string; quantity?: number; unit?: string; tranDate?: string }>
}): IntegrationRecord[] {
  const out: IntegrationRecord[] = []
  for (const r of payload.items ?? []) {
    const date = toDate(r.tranDate)
    if (!r.id || typeof r.quantity !== 'number' || r.quantity <= 0 || !date) continue
    out.push({
      domain: 'MATERIALS',
      fieldName: 'quantity',
      value: r.quantity,
      unit: r.unit ?? 'units',
      periodStart: date,
      periodEnd: date,
      sourceRef: r.id,
    })
  }
  return out
}
