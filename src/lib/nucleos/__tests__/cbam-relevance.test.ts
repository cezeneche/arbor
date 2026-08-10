import { isCbamRelevant, CBAM_RELEVANT_DOCUMENT_TYPES } from '../cbam-relevance'
import { toExtractedFieldRows } from '../field-mapper'
import type { CbamExtractionResult } from '../contract'

// Which documents go to Nucleos, and how what comes back becomes ExtractedField
// rows. Both halves are pure so the Inngest function stays a thin caller.

describe('isCbamRelevant', () => {
  it('routes the three document types that carry CBAM fields', () => {
    expect(isCbamRelevant('CUSTOMS_DECLARATION')).toBe(true)
    expect(isCbamRelevant('SUPPLIER_INVOICE')).toBe(true)
    expect(isCbamRelevant('CBAM_DECLARATION')).toBe(true)
  })

  it('leaves everything else on Arbor’s own extraction path', () => {
    for (const t of ['ELECTRICITY_BILL', 'PRODUCTION_LOG', 'CROP_YIELD_RECORD', 'OTHER']) {
      expect(isCbamRelevant(t)).toBe(false)
    }
  })

  it('is not case-sensitive about the document type string', () => {
    expect(isCbamRelevant('customs_declaration')).toBe(true)
  })

  it('exposes the set so the decision is auditable in one place', () => {
    expect([...CBAM_RELEVANT_DOCUMENT_TYPES].sort()).toEqual([
      'CBAM_DECLARATION',
      'CUSTOMS_DECLARATION',
      'SUPPLIER_INVOICE',
    ])
  })
})

function result(overrides: Partial<CbamExtractionResult> = {}): CbamExtractionResult {
  return {
    document_id: 'doc-1',
    fields: [
      {
        field_name: 'importer_eori',
        raw_value: 'GB123456789000',
        raw_unit: null,
        source_text: 'EORI: GB123456789000',
        confidence: 0.96,
        extractor: 'rule_regex',
        flags: [],
        evidence: [],
      },
    ],
    lines: [],
    flags: [],
    engine: { engine_version: '0.1.0' },
    ...overrides,
  } as CbamExtractionResult
}

describe('toExtractedFieldRows', () => {
  it('maps a field to an ExtractedField row', () => {
    const [row] = toExtractedFieldRows(result())
    expect(row.fieldName).toBe('importer_eori')
    expect(row.rawValue).toBe('GB123456789000')
    expect(row.sourceText).toBe('EORI: GB123456789000')
    expect(row.confidenceScore).toBe(0.96)
  })

  it('flags anything below the confidence threshold', () => {
    const rows = toExtractedFieldRows(
      result({
        fields: [
          {
            field_name: 'net_mass_kg',
            raw_value: '24500',
            raw_unit: 'kg',
            source_text: 'Net mass: 24500 kg',
            confidence: 0.4,
            extractor: 'claude',
            flags: [],
            evidence: [],
          },
        ],
      } as Partial<CbamExtractionResult>),
    )
    expect(rows[0].flagged).toBe(true)
  })

  it('carries Nucleos flag strings verbatim into flagReason', () => {
    // These are the anti-hallucination signals a reviewer acts on. Summarising
    // them in transit would leave "there was an issue".
    const rows = toExtractedFieldRows(
      result({
        fields: [
          {
            field_name: 'cn_code',
            raw_value: '72071111',
            raw_unit: null,
            source_text: 'CN code: 72071111',
            confidence: 0.9,
            extractor: 'rule_regex',
            flags: ['arbiter_conflict:cn_code', 'repair_failed:invoice_date'],
            evidence: [],
          },
        ],
      } as Partial<CbamExtractionResult>),
    )
    expect(rows[0].flagged).toBe(true)
    expect(rows[0].flagReason).toContain('arbiter_conflict:cn_code')
    expect(rows[0].flagReason).toContain('repair_failed:invoice_date')
  })

  it('a field with no source text is flagged', () => {
    // Without source text a reviewer has nothing to confirm against, so it can
    // never legitimately become Verified.
    const rows = toExtractedFieldRows(
      result({
        fields: [
          {
            field_name: 'origin_country',
            raw_value: 'TR',
            raw_unit: null,
            source_text: null,
            confidence: 0.99,
            extractor: 'claude',
            flags: [],
            evidence: [],
          },
        ],
      } as Partial<CbamExtractionResult>),
    )
    expect(rows[0].flagged).toBe(true)
    expect(rows[0].flagReason).toContain('no_source_text')
  })

  it('turns goods lines into indexed field rows', () => {
    const rows = toExtractedFieldRows(
      result({
        fields: [],
        lines: [
          {
            line_index: 0,
            cn_code: '72071111',
            net_mass_kg: 24500,
            description: null,
            origin_country: 'TR',
            production_route: null,
            installation_id: null,
            installation_name: null,
            direct_embedded_kgco2e: 44100,
            indirect_embedded_kgco2e: null,
            emissions_method: 'ACTUAL',
            flags: [],
          },
        ],
      } as Partial<CbamExtractionResult>),
    )
    const names = rows.map((r) => r.fieldName)
    expect(names).toContain('lines[0].cn_code')
    expect(names).toContain('lines[0].net_mass_kg')
    expect(names).toContain('lines[0].emissions_method')
  })

  it('never emits a provenance tier', () => {
    // Extraction produces drafts. Only a human action in Review sets provenance.
    const rows = toExtractedFieldRows(result())
    for (const row of rows) {
      expect(JSON.stringify(row)).not.toMatch(/provenanceTier|trustTier|VERIFIED/)
    }
  })

  it('document-level flags attach to every row so none is silently clean', () => {
    const rows = toExtractedFieldRows(result({ flags: ['source_truncated:page cap'] }))
    expect(rows[0].flagged).toBe(true)
    expect(rows[0].flagReason).toContain('source_truncated:page cap')
  })
})
