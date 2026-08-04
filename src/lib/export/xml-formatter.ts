// Layer 3  -  packaging only. No calculation logic.
// Formats DataRecord rows as XML.
// Trust tier is an attribute on every Record element  -  cannot be omitted.
//
// Every Record also carries a Definition element on the same terms: what the
// number means, what the boundary includes and excludes, and whether the
// receiving buyer has agreed that wording. An ungoverned field emits
// governed="false" rather than omitting the element, so the absence is stated
// rather than inferred from a missing tag.

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

function definitionElement(r: ExportRecord): string {
  const agreement = r.agreement?.status ?? 'NONE'
  const def = r.definition
  if (!def) {
    return `    <Definition agreement="${escapeXml(agreement)}" governed="false"/>`
  }
  const agreedVersion = r.agreement?.agreedVersion
  return `    <Definition agreement="${escapeXml(agreement)}" governed="true" version="${def.version}"${
    agreedVersion != null ? ` agreedVersion="${agreedVersion}"` : ''
  }>
      <Label>${escapeXml(def.label)}</Label>
      <Meaning>${escapeXml(def.definition)}</Meaning>
      <Boundary>${escapeXml(def.boundary)}</Boundary>
      <Source>${escapeXml(def.sourceStandard)}</Source>
      <EffectiveFrom>${escapeXml(toIso(def.effectiveFrom))}</EffectiveFrom>
    </Definition>`
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
${definitionElement(r)}
  </Record>`)

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<ArborExport version="1.0" recordCount="${records.length}">`,
    ...recordElements,
    '</ArborExport>',
  ].join('\n')
}
