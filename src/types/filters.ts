export type SectorOption =
  | 'Steel'
  | 'Aluminium'
  | 'Cement'
  | 'Fertiliser'
  | 'Hydrogen'
  | 'Agriculture'
  | 'Other'

export type TrustTier = 'A' | 'B' | 'C'

export type DataDomain =
  | 'ENERGY'
  | 'MATERIALS'
  | 'PRODUCTION'
  | 'LOGISTICS'
  | 'EMISSIONS'
  | 'AGRICULTURE'
  | 'WASTE_AND_WATER'
  | 'COMPLIANCE'

/** Quarter string in the form "YYYY-QN" — e.g. "2026-Q1". */
export type QuarterValue = string

export interface FilterState {
  /** Empty array means all sectors. */
  sectors: SectorOption[]
  /** Empty array means all countries. Populated dynamically from dataset. */
  countries: string[]
  /** Start of the selected period (inclusive). */
  periodFrom: QuarterValue
  /** End of the selected period (inclusive). */
  periodTo: QuarterValue
  /** All three present = all tiers. Fewer = only the listed tiers. */
  trustTiers: TrustTier[]
  /** Single selected domain. */
  domain: DataDomain
}
