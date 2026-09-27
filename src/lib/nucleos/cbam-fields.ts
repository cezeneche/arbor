// The field names a Nucleos CBAM extraction produces, and what each one is for.
//
// Arbor's other document types have a fixed field list per type, declared in
// `field-definitions.ts`. A CBAM document does not: a customs declaration has
// as many goods lines as it has goods, so its field names are generated —
// `lines[0].cn_code`, `lines[1].net_mass_kg` — and no fixed list can enumerate
// them. Everything downstream of extraction needs to be able to recognise one,
// so the recognition lives here rather than as a regex repeated at each site.
//
// Two classifications, and they are not the same question:
//
//   Is this a CBAM field?     — may it be confirmed on a CBAM document at all.
//   Is it a measured quantity? — does confirming it write a DataRecord.
//
// A CN code is eight digits and would parse as a number, so the second question
// cannot be answered by looking at the value. Storing "72081000" as a quantity
// would produce a Verified record reading seventy-two million kilograms.
//
// Pure. No I/O.

/** Scalar fields, matching `_SCALAR_FIELDS` in Nucleos's extraction endpoint. */
export const CBAM_SCALAR_FIELDS: readonly string[] = [
  'importer_name',
  'importer_eori',
  'operator_name',
  'installation_name',
  'installation_id',
  'invoice_number',
  'invoice_date',
  'import_date',
  'origin_country',
  'incoterm',
  'entry_reference',
  'production_route',
  'carbon_price_paid_eur',
  'carbon_price_paid_currency',
] as const

/** Per-goods-line fields, matching what `toExtractedFieldRows` emits. */
export const CBAM_GOODS_LINE_FIELDS: readonly string[] = [
  'cn_code',
  'description',
  'net_mass_kg',
  'origin_country',
  'production_route',
  'installation_id',
  'installation_name',
  'direct_embedded_kgco2e',
  'indirect_embedded_kgco2e',
  'emissions_method',
] as const

/**
 * The goods-line fields that are measured quantities, with the unit each is
 * measured in.
 *
 * These are the only CBAM fields that become DataRecords. The units are the
 * conversion engine's own spellings — `kg_co2e`, not `kgCO2e` — because a unit
 * the engine does not recognise cannot be converted on output, and Layer 3's
 * whole promise is that any recipient can ask for their own units.
 */
export const CBAM_NUMERIC_GOODS_LINE_FIELDS: Readonly<Record<string, string>> = {
  net_mass_kg: 'kg',
  direct_embedded_kgco2e: 'kg_co2e',
  indirect_embedded_kgco2e: 'kg_co2e',
}

const SCALARS = new Set<string>(CBAM_SCALAR_FIELDS)
const LINE_FIELDS = new Set<string>(CBAM_GOODS_LINE_FIELDS)

const GOODS_LINE_NAME = /^lines\[(\d+)\]\.(.+)$/

export interface GoodsLineFieldRef {
  lineIndex: number
  field: string
}

/**
 * Split `lines[N].field` into its parts, or null if it is not one.
 *
 * A well-formed name naming a field Nucleos does not emit returns null too. An
 * unrecognised key that got this far would be dropped later, when the case
 * payload is assembled — a quieter place to lose it than here.
 */
export function parseGoodsLineFieldName(name: string): GoodsLineFieldRef | null {
  const m = GOODS_LINE_NAME.exec(name ?? '')
  if (!m) return null
  const field = m[2].trim()
  if (!LINE_FIELDS.has(field)) return null
  return { lineIndex: Number(m[1]), field }
}

export function goodsLineFieldName(lineIndex: number, field: string): string {
  return `lines[${lineIndex}].${field}`
}

/** Whether this name is one a CBAM extraction can produce. */
export function isCbamFieldName(name: string): boolean {
  return SCALARS.has(name) || parseGoodsLineFieldName(name) !== null
}

/** Whether confirming this field should write a DataRecord. */
export function isCbamNumericFieldName(name: string): boolean {
  const ref = parseGoodsLineFieldName(name)
  return ref !== null && ref.field in CBAM_NUMERIC_GOODS_LINE_FIELDS
}

/**
 * Whether a confirmed CBAM document has everything Tier A requires.
 *
 * The generic tier derivation cannot answer this. It compares a fixed list of
 * compulsory names from `field-definitions.ts` — `commodity_code`,
 * `declared_weight` — against what was confirmed, and a Nucleos extraction
 * emits `lines[0].cn_code` and `lines[0].net_mass_kg`. The two vocabularies
 * never intersect, so the compulsory set could never be satisfied and every
 * CBAM record was written Declared however well evidenced it was. That then
 * travelled onto every calculated line as DECLARED provenance.
 *
 * The rules applied are the admissibility spec's, for a customs declaration:
 * the importer must be identified, and every goods line must carry a full
 * 8-digit CN code, a weight and a stated origin (its own or the document's). A
 * 6-digit HS heading is a critical flag — it carries no sector and no default
 * value — so it does not qualify.
 *
 * Every line, not any line. The tier is the document's and every record the
 * document writes carries it, so one complete line used to certify a half-read
 * second line's records as Verified on the strength of the first.
 */
export function cbamCompulsoryFieldsPresent(
  confirmed: ReadonlyMap<string, string>,
  /**
   * The text each value was read from, when the caller is deciding a trust
   * tier. Verified means a record can be confirmed against its document, so a
   * value with nothing to confirm it against cannot carry the tier — the rule
   * read presence alone, and certified documents Verified whose every value
   * arrived with no source text. Omitted by callers asking only whether the
   * fields are there.
   */
  sourceText?: ReadonlyMap<string, string | null>,
): boolean {
  const value = (key: string): string | null => {
    const raw = confirmed.get(key)
    if (raw === undefined || raw === null) return null
    const trimmed = String(raw).trim()
    if (trimmed === '') return null
    if (sourceText && !(sourceText.get(key) ?? '').trim()) return null
    return trimmed
  }

  if (!value('importer_eori') && !value('importer_name')) return false

  // A line the reviewer cleared entirely is not on the document any more; one
  // with anything left on it is, and has to qualify.
  const lineIndexes = new Set<number>()
  for (const [name, raw] of confirmed) {
    const ref = parseGoodsLineFieldName(name)
    if (ref && String(raw ?? '').trim() !== '') lineIndexes.add(ref.lineIndex)
  }
  if (lineIndexes.size === 0) return false

  const documentOrigin = value('origin_country')

  for (const i of lineIndexes) {
    const cnCode = value(goodsLineFieldName(i, 'cn_code'))
    const massRaw = value(goodsLineFieldName(i, 'net_mass_kg'))
    const mass = massRaw === null ? null : Number(massRaw)
    const origin = value(goodsLineFieldName(i, 'origin_country')) ?? documentOrigin

    if (!cnCode || cnCode.replace(/\D/g, '').length !== 8) return false
    if (mass === null || !Number.isFinite(mass) || mass <= 0) return false
    if (!origin) return false
  }

  return true
}
