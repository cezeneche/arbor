// The seed data dictionary — version 1 of the governed wording for every field
// that can become a stored DataRecord and therefore reach a buyer. Pure constants:
// no DB, no AI. The Layer 2 seeder writes these once; every later change is a new
// version via planNewVersion, never an edit here.
//
// Scope is deliberately NUMERIC_FIELDS, the set the review pipeline promotes into
// the store. Extraction reads far more fields than that, but a field that never
// becomes a record never travels to a counterparty and needs no agreed wording.
//
// Two rules govern the writing:
//
//  1. Plain English. An office manager at a five-person steel stockholder is the
//     reader (PRD §7). No framework names, no tier codes, no acronyms unexplained.
//  2. Every boundary states an inclusion AND an exclusion. "What is counted"
//     without "what is not counted" is where two companies quietly disagree while
//     both believing they agree — and that disagreement is invisible until an
//     auditor finds it.
//
// field_name is unique only WITHIN a domain. "quantity" on a fuel receipt is
// litres of diesel; "quantity" on a waste transfer note is tonnes of waste. The
// dictionary is keyed on the pair, and the seed intentionally carries several
// same-named entries to keep that honest.

import type { DataDomain } from '@/lib/constants'
import type { StoredFieldDefinition, DefinitionAdmissibility } from './registry'

export interface SeedDefinition {
  fieldName: string
  domain: DataDomain
  label: string
  definition: string
  boundary: string
  canonicalUnit: string | null
  admissibility: DefinitionAdmissibility
  sourceStandard: string
}

const SPEC = 'Arbor Admissibility Spec v1.0'

export const SEED_DEFINITIONS: SeedDefinition[] = [
  // ── ENERGY ────────────────────────────────────────────────────────────────
  {
    fieldName: 'total_consumption_kwh',
    domain: 'ENERGY',
    label: 'Energy used',
    definition:
      'The total electricity or gas your site drew from the supply network over the billing period shown on the bill.',
    boundary:
      'Includes all metered supply delivered to the site across the period, whether the meter was read or the reading was estimated. Excludes energy you generated on site and used yourself, energy you exported back to the grid, and energy used at any other site on a separate meter.',
    canonicalUnit: 'mj',
    admissibility: 'COMPULSORY',
    sourceStandard: SPEC,
  },
  {
    fieldName: 'total_consumption_m3',
    domain: 'ENERGY',
    label: 'Gas volume used',
    definition:
      'The volume of gas your site drew from the network over the billing period, as measured at the meter before any conversion to energy units.',
    boundary:
      'Includes the metered volume for the period stated on the bill. Excludes any volume already converted and reported as an energy figure elsewhere on the same bill, which would otherwise be counted twice.',
    canonicalUnit: 'm3',
    admissibility: 'CONDITIONAL',
    sourceStandard: SPEC,
  },
  {
    fieldName: 'calorific_value',
    domain: 'ENERGY',
    label: 'Gas energy content',
    definition:
      'The energy content of the gas supplied, used by your supplier to convert the volume at your meter into an energy figure on the bill.',
    boundary:
      'Includes the value your supplier applied for this specific billing period. Excludes national or annual average figures not printed on your own bill, because the conversion cannot be checked against a value that was never used.',
    canonicalUnit: null,
    admissibility: 'CONDITIONAL',
    sourceStandard: SPEC,
  },
  {
    fieldName: 'quantity',
    domain: 'ENERGY',
    label: 'Fuel purchased',
    definition:
      'The amount of fuel bought on this receipt or invoice — diesel, petrol, gas oil, LPG or similar.',
    boundary:
      'Includes the fuel delivered or drawn on the date shown. Excludes fuel ordered but not yet delivered, fuel returned, and any fuel purchased for resale rather than for your own use. Purchased is not the same as burned: a full tank at the period end has been bought but not yet consumed.',
    canonicalUnit: 'm3',
    admissibility: 'COMPULSORY',
    sourceStandard: SPEC,
  },
  {
    fieldName: 'quantity_mwh',
    domain: 'ENERGY',
    label: 'Renewable energy certified',
    definition:
      'The amount of renewable electricity covered by this certificate, as issued by the certifying body.',
    boundary:
      'Includes only the volume stated on the certificate for the stated generation year. Excludes any certificate already retired, already claimed for another period, or held on behalf of a third party — a certificate can only ever be counted once, by one holder.',
    canonicalUnit: 'mj',
    admissibility: 'COMPULSORY',
    sourceStandard: SPEC,
  },

  // ── MATERIALS ─────────────────────────────────────────────────────────────
  {
    fieldName: 'quantity',
    domain: 'MATERIALS',
    label: 'Material received',
    definition:
      'The amount of raw material or input received into your site on this delivery, as recorded on the delivery note or intake record.',
    boundary:
      'Includes material accepted into stock on the delivery date. Excludes material rejected on arrival, material still in transit, and packaging weight where the record distinguishes it. Received is not the same as used: material can sit in stock across several periods.',
    canonicalUnit: 'kg',
    admissibility: 'COMPULSORY',
    sourceStandard: SPEC,
  },
  {
    fieldName: 'total_value',
    domain: 'MATERIALS',
    label: 'Invoice total',
    definition:
      'The total amount charged on this supplier invoice, in the currency shown on the invoice.',
    boundary:
      'Includes the goods and services billed on this invoice document. Excludes amounts on separate credit notes, amounts billed on other invoices for the same order, and any figure converted into another currency — the value stands in the currency it was issued in.',
    canonicalUnit: null,
    admissibility: 'COMPULSORY',
    sourceStandard: SPEC,
  },

  // ── PRODUCTION ────────────────────────────────────────────────────────────
  {
    fieldName: 'quantity_produced',
    domain: 'PRODUCTION',
    label: 'Amount produced',
    definition:
      'The amount of finished product your site made over the period covered by this production log or batch record.',
    boundary:
      'Includes saleable output that completed the process stage named on the record. Excludes work still in progress at the period end, scrap and rejected output, and material reprocessed from an earlier batch, which would otherwise be counted twice.',
    canonicalUnit: 'kg',
    admissibility: 'COMPULSORY',
    sourceStandard: SPEC,
  },
  {
    fieldName: 'energy_consumption_total',
    domain: 'PRODUCTION',
    label: 'Energy used in production',
    definition:
      'The energy consumed by the production process over the period covered by this production log, as recorded on the log itself.',
    boundary:
      'Includes energy attributed to the process stage named on the record. Excludes site energy not attributable to production — lighting, heating and offices — and excludes energy already reported on a utility bill for the same period unless the two are being deliberately cross-checked.',
    canonicalUnit: 'mj',
    admissibility: 'OPTIONAL',
    sourceStandard: SPEC,
  },
  {
    fieldName: 'energy_consumption',
    domain: 'PRODUCTION',
    label: 'Process energy used',
    definition:
      'The energy consumed by the specific process described on this process data sheet over the stated period.',
    boundary:
      'Includes energy consumed by the named process only. Excludes energy for other processes on the same site and excludes any energy figure the sheet has already apportioned to a different process, so no unit of energy is attributed twice.',
    canonicalUnit: 'mj',
    admissibility: 'OPTIONAL',
    sourceStandard: SPEC,
  },

  // ── LOGISTICS ─────────────────────────────────────────────────────────────
  {
    fieldName: 'shipment_weight',
    domain: 'LOGISTICS',
    label: 'Shipment weight',
    definition:
      'The weight of the goods moved on this shipment, as billed by the carrier on the freight invoice.',
    boundary:
      'Includes the weight the carrier charged against, for the legs covered by this invoice. Excludes legs invoiced separately by another carrier and excludes any volumetric or chargeable weight the carrier used for pricing where it differs from the actual weight — the figure recorded is the goods, not the billing basis.',
    canonicalUnit: 'kg',
    admissibility: 'COMPULSORY',
    sourceStandard: SPEC,
  },
  {
    fieldName: 'gross_weight',
    domain: 'LOGISTICS',
    label: 'Gross weight shipped',
    definition:
      'The total weight of the consignment as declared on the bill of lading, including its packaging.',
    boundary:
      'Includes goods plus packaging and pallets as presented to the carrier. Excludes the weight of the container or trailer itself, and excludes any part of the consignment released under a separate bill of lading.',
    canonicalUnit: 'kg',
    admissibility: 'COMPULSORY',
    sourceStandard: SPEC,
  },

  // ── COMPLIANCE ────────────────────────────────────────────────────────────
  {
    fieldName: 'declared_weight',
    domain: 'COMPLIANCE',
    label: 'Weight declared to customs',
    definition:
      'The weight of goods declared to customs on this import entry, against the commodity code shown.',
    boundary:
      'Includes the net weight declared for this commodity code on this entry. Excludes other commodity codes on the same entry, which are separate records, and excludes any amendment made on a later entry unless that entry is itself submitted.',
    canonicalUnit: 'kg',
    admissibility: 'COMPULSORY',
    sourceStandard: SPEC,
  },
  {
    fieldName: 'quantity_tonnes',
    domain: 'COMPLIANCE',
    label: 'Goods quantity declared',
    definition:
      'The quantity of goods covered by this regulatory declaration, for the production period stated on it.',
    boundary:
      'Includes the quantity declared for the commodity code and production period named. Excludes goods produced in the period but declared separately, and excludes goods held in stock from an earlier period.',
    canonicalUnit: 'kg',
    admissibility: 'COMPULSORY',
    sourceStandard: SPEC,
  },
  {
    fieldName: 'embedded_emissions_tco2e',
    domain: 'COMPLIANCE',
    label: 'Emissions declared for these goods',
    definition:
      'The emissions figure stated on this declaration for the goods it covers. Arbor records the figure as declared — it does not calculate or check it.',
    boundary:
      'Includes the total the declarant stated for the commodity and production period named, on the methodology named. Excludes any figure Arbor might derive itself, because Arbor performs no emissions calculation, and excludes emissions from goods outside this declaration.',
    canonicalUnit: 'kg_co2e',
    admissibility: 'COMPULSORY',
    sourceStandard: SPEC,
  },
  {
    fieldName: 'embedded_emissions_per_tonne',
    domain: 'COMPLIANCE',
    label: 'Emissions per tonne declared',
    definition:
      'The emissions per tonne of goods stated on this declaration. Arbor records the figure as declared — it does not calculate or check it.',
    boundary:
      'Includes the intensity figure as printed, on the methodology and calculation tier named on the declaration. Excludes any figure derived by dividing one stored record by another, which would be a calculation Arbor does not perform.',
    canonicalUnit: null,
    admissibility: 'COMPULSORY',
    sourceStandard: SPEC,
  },

  // ── EMISSIONS ─────────────────────────────────────────────────────────────
  {
    fieldName: 'total_co2e',
    domain: 'EMISSIONS',
    label: 'Total emissions reported',
    definition:
      'The total emissions figure stated in this carbon footprint report or assessment, for the data year the report covers.',
    boundary:
      'Includes the total exactly as the report states it, within the system boundary the report itself declares. Excludes anything outside that declared boundary, and excludes any recalculation — two reports on different boundaries are two different records, never one combined figure.',
    canonicalUnit: 'kg_co2e',
    admissibility: 'COMPULSORY',
    sourceStandard: SPEC,
  },
  {
    fieldName: 'factor_value',
    domain: 'EMISSIONS',
    label: 'Published conversion factor',
    definition:
      'A published conversion factor cited in this document, recorded so the source of any figure calculated from it can be traced.',
    boundary:
      'Includes the factor as published, for the activity type and reporting year stated by its publisher. Excludes any application of the factor to your own activity data — Arbor stores the factor and the activity separately and never multiplies one by the other.',
    canonicalUnit: null,
    admissibility: 'COMPULSORY',
    sourceStandard: SPEC,
  },

  // ── WASTE AND WATER ───────────────────────────────────────────────────────
  {
    fieldName: 'quantity',
    domain: 'WASTE_AND_WATER',
    label: 'Waste transferred',
    definition:
      'The amount of waste transferred off site under this waste transfer or consignment note, by the disposal route stated on it.',
    boundary:
      'Includes waste handed to the licensed carrier on the date shown, for the disposal method named. Excludes waste still held on site, waste transferred under a different note, and material sold as a by-product rather than transferred as waste.',
    canonicalUnit: 'kg',
    admissibility: 'COMPULSORY',
    sourceStandard: SPEC,
  },
  {
    fieldName: 'quantity_m3',
    domain: 'WASTE_AND_WATER',
    label: 'Water used',
    definition:
      'The volume of water your site took from its stated source over the period covered by this record.',
    boundary:
      'Includes water withdrawn from the source named on the record for the stated period. Excludes water discharged or returned, water recycled and reused on site where the record reports it separately, and water drawn at any other site.',
    canonicalUnit: 'm3',
    admissibility: 'COMPULSORY',
    sourceStandard: SPEC,
  },

  // ── AGRICULTURE ───────────────────────────────────────────────────────────
  {
    fieldName: 'area_hectares',
    domain: 'AGRICULTURE',
    label: 'Area farmed',
    definition:
      'The area of the field or parcel this yield record covers, as stated on the record.',
    boundary:
      'Includes the cropped area of the parcel named. Excludes uncropped margins, tracks and buildings within the parcel boundary, and excludes any area double-counted where two crops were grown on the same ground in one season.',
    canonicalUnit: 'm2',
    admissibility: 'COMPULSORY',
    sourceStandard: SPEC,
  },
  {
    fieldName: 'yield_quantity',
    domain: 'AGRICULTURE',
    label: 'Harvest quantity',
    definition:
      'The amount harvested from the field or parcel named on this record, for the harvest date stated.',
    boundary:
      'Includes the quantity taken off the parcel at harvest. Excludes crop left in the field, losses in storage after harvest, and any quantity already recorded against a different parcel or season.',
    canonicalUnit: 'kg',
    admissibility: 'COMPULSORY',
    sourceStandard: SPEC,
  },
  {
    fieldName: 'nitrogen_content_percent',
    domain: 'AGRICULTURE',
    label: 'Nitrogen content of fertiliser',
    definition:
      'The proportion of nitrogen in the fertiliser product applied, as stated on the product label or application record.',
    boundary:
      'Includes the nitrogen declared for the product actually applied. Excludes phosphorus and potassium content, which are recorded separately, and excludes nitrogen from manure or crop residues unless that application is recorded in its own right.',
    canonicalUnit: null,
    admissibility: 'COMPULSORY',
    sourceStandard: SPEC,
  },
  {
    fieldName: 'average_herd_size',
    domain: 'AGRICULTURE',
    label: 'Average number of animals',
    definition:
      'The average number of animals of the stated species kept at this site across the period the record covers.',
    boundary:
      'Includes animals present at the named site across the stated period, averaged over that period rather than counted on one day. Excludes animals kept at other sites, animals held in transit, and any species recorded separately.',
    canonicalUnit: null,
    admissibility: 'COMPULSORY',
    sourceStandard: SPEC,
  },
]

/**
 * A stable id per field+domain. Re-running the seeder must not create a second
 * version 1 of the same wording, so the id is derived rather than generated.
 */
export function seedDefinitionId(fieldName: string, domain: DataDomain): string {
  return `seed-v1-${domain.toLowerCase()}-${fieldName}`
}

/** The seed dictionary as version 1, in force from `effectiveFrom` and open-ended. */
export function seedDefinitionsAsStored(effectiveFrom: Date): StoredFieldDefinition[] {
  return SEED_DEFINITIONS.map(d => ({
    id: seedDefinitionId(d.fieldName, d.domain),
    fieldName: d.fieldName,
    domain: d.domain,
    version: 1,
    effectiveFrom,
    effectiveTo: null,
    label: d.label,
    definition: d.definition,
    boundary: d.boundary,
    canonicalUnit: d.canonicalUnit,
    admissibility: d.admissibility,
    sourceStandard: d.sourceStandard,
  }))
}
