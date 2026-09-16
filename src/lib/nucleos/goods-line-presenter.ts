// A case's goods lines → the rows the case detail shows.
//
// Kept out of the page for the same reason the case presenter is: the decisions
// here can mislead. Chiefly the last one — a goods line with no emissions
// figure shows an em-dash and a plain sentence saying a figure is still needed,
// never a zero. A zero on a declaration line reads as "these goods produced no
// emissions", which is the opposite of "nobody has said yet".

import type { CaseGoodsLine } from './declaration-payload'

export interface PresentedGoodsLine {
  /** Nucleos's id, so the line can be matched to its calculated counterpart. */
  id: string
  /** 1-based, for a user counting lines down a page. */
  position: number
  cnCode: string
  /** True when the code is not the full 8 digits CBAM needs. */
  cnCodeIncomplete: boolean
  description: string
  mass: string
  origin: string
  installation: string
  /** The figure the source document declared, or an em-dash. */
  declaredEmissions: string
  /** Present when no figure has been supplied. Says what to do about it. */
  emissionsNeeded: string | null
}

const DASH = '—'

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  return s === '' ? null : s
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function presentGoodsLine(raw: CaseGoodsLine, index: number): PresentedGoodsLine {
  const cnCode = str(raw.cn_code)
  const mass = num(raw.net_mass_kg) ?? num(raw.quantity)
  const direct = num(raw.direct_kgco2e)
  const indirect = num(raw.indirect_kgco2e)

  // The direct figure is what a declaration is built on — the UK charges it
  // alone, and the EU charges it plus indirect. A line with indirect but no
  // direct therefore has no total, and adding the two with direct standing in
  // as zero would render a confident, complete-looking figure that understates
  // the line by all of its direct emissions. That is the exact substitution
  // this module exists to refuse.
  const declared = direct === null ? null : (direct + (indirect ?? 0)) / 1000
  const indirectOnly = direct === null && indirect !== null

  return {
    id: str(raw.id) ?? `line-${index + 1}`,
    position: index + 1,
    cnCode: cnCode ?? DASH,
    // A 6-digit HS heading is not a CN code: it carries no sector and no
    // default value, so a line with one cannot be declared. Flagged on the row
    // rather than only in the extraction, because this is where it is acted on.
    cnCodeIncomplete: cnCode !== null && cnCode.replace(/\D/g, '').length !== 8,
    description: str(raw.product_description) ?? str(raw.description) ?? DASH,
    mass:
      mass !== null && mass > 0
        ? `${(mass / 1000).toLocaleString('en-GB', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })} t`
        : DASH,
    origin: str(raw.origin_country) ?? DASH,
    installation: str(raw.installation_name) ?? str(raw.installation_id) ?? DASH,
    declaredEmissions:
      declared === null
        ? DASH
        : `${declared.toLocaleString('en-GB', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })} tCO2e`,
    emissionsNeeded:
      declared !== null
        ? null
        : indirectOnly
          ? 'Only the electricity figure has been given for these goods. The direct ' +
            'emissions from making them are still needed before this line can be declared.'
          : 'No emissions figure yet. Ask the supplier, or use the published default — ' +
            'the default is always available and always higher.',
  }
}

export function presentGoodsLines(
  lines: readonly CaseGoodsLine[] | undefined,
): PresentedGoodsLine[] {
  return (lines ?? []).map(presentGoodsLine)
}
