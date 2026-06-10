// Layer 3  -  packaging only. No calculation logic.
// Formats DataRecord rows as RFC 4180 CSV.
// Trust tier is always present  -  cannot be omitted.

export interface ExportRecord {
  id: string
  domain: string
  fieldName: string
  value: number
  unit: string
  trustTier: string
  confidenceScore: number
  periodStart: Date | string
  periodEnd: Date | string
  extractionMethod: string
  documentId: string | null
}

const HEADERS = [
  'id', 'domain', 'fieldName', 'value', 'unit',
  'trustTier', 'confidenceScore',
  'periodStart', 'periodEnd',
  'extractionMethod', 'sourceDocumentId',
] as const

function escapeCsv(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function toIso(d: Date | string): string {
  if (d instanceof Date) return d.toISOString()
  return d
}

export function formatRecordsAsCSV(records: ExportRecord[]): string {
  const header = HEADERS.join(',')
  const rows = records.map(r =>
    [
      r.id,
      r.domain,
      r.fieldName,
      r.value,
      r.unit,
      r.trustTier,
      r.confidenceScore,
      toIso(r.periodStart),
      toIso(r.periodEnd),
      r.extractionMethod,
      r.documentId ?? '',
    ].map(escapeCsv).join(','),
  )
  return [header, ...rows].join('\r\n')
}
