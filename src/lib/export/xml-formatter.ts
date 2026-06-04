// Layer 3 — packaging only. No calculation logic.
// Formats DataRecord rows as XML.
// Trust tier is an attribute on every Record element — cannot be omitted.

import type { ExportRecord } from './csv-formatter'

function escapeXml(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function toIso(d: Date | string): string {
  if (d instanceof Date) return d.toISOString()
  return d
}

export function formatRecordsAsXML(records: ExportRecord[]): string {
  const recordElements = records.map(r => `  <Record
    id="${escapeXml(r.id)}"
    trustTier="${escapeXml(r.trustTier)}"
    confidenceScore="${r.confidenceScore}">
    <Domain>${escapeXml(r.domain)}</Domain>
    <FieldName>${escapeXml(r.fieldName)}</FieldName>
    <Value unit="${escapeXml(r.unit)}">${r.value}</Value>
    <PeriodStart>${escapeXml(toIso(r.periodStart))}</PeriodStart>
    <PeriodEnd>${escapeXml(toIso(r.periodEnd))}</PeriodEnd>
    <ExtractionMethod>${escapeXml(r.extractionMethod)}</ExtractionMethod>
    <SourceDocumentId>${escapeXml(r.documentId)}</SourceDocumentId>
  </Record>`)

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<ArborExport version="1.0" recordCount="${records.length}">`,
    ...recordElements,
    '</ArborExport>',
  ].join('\n')
}
