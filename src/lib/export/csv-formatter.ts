// Layer 3  -  packaging only. No calculation logic.
// Formats DataRecord rows as RFC 4180 CSV.
// Trust tier is always present  -  cannot be omitted.
//
// The agreed definition travels on the same terms. A recipient system given
// "480000 mj" and no statement of what was counted is back to the unverifiable
// spreadsheet the platform exists to replace, so the wording, the boundary and
// the agreement state are columns, not an optional annex. An ungoverned field
// exports empty definition cells and an explicit NONE  -  honest absence, never
// a fabricated meaning.

import type { AttachedDefinition, AttachedAgreement } from '@/lib/layer3/attach-definitions'

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
  /** Attached by Layer 3 (attachDefinitions). Null when the field is ungoverned. */
  definition?: AttachedDefinition | null
  /** Absent when the caller has not resolved agreement; exported as NONE. */
  agreement?: AttachedAgreement
}

const HEADERS = [
  'id', 'domain', 'fieldName', 'value', 'unit',
  'trustTier', 'confidenceScore',
  'periodStart', 'periodEnd',
  'extractionMethod', 'sourceDocumentId',
  'definitionVersion', 'definitionLabel', 'definitionText', 'definitionBoundary',
  'definitionSource', 'definitionAgreement', 'definitionAgreedVersion',
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
  const rows = records.map(r => {
    const def = r.definition ?? null
    // An undecorated or ungoverned record still fills every column, so the row
    // width matches the header and the file stays parseable.
    return [
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
      def?.version ?? '',
      def?.label ?? '',
      def?.definition ?? '',
      def?.boundary ?? '',
      def?.sourceStandard ?? '',
      r.agreement?.status ?? 'NONE',
      r.agreement?.agreedVersion ?? '',
    ].map(escapeCsv).join(',')
  })
  return [header, ...rows].join('\r\n')
}
