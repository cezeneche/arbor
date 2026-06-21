import { DOCUMENT_FIELD_DEFINITIONS } from '@/lib/extraction/field-definitions'

// Layer 3 — read-only reference. Derives, per data domain, the set of compulsory
// field names from the admissibility definitions. This reads Layer 1 constants
// only; it runs no extraction and writes nothing. Used to report which compulsory
// fields are absent from records already in the database.

const DOC_TYPE_TO_DOMAIN: Record<string, string> = {
  ELECTRICITY_BILL: 'ENERGY', GAS_BILL: 'ENERGY', FUEL_RECEIPT: 'ENERGY',
  RENEWABLE_CERTIFICATE: 'ENERGY',
  PRODUCTION_LOG: 'PRODUCTION', BILL_OF_MATERIALS: 'PRODUCTION',
  PROCESS_DATA_SHEET: 'PRODUCTION',
  MATERIAL_INTAKE: 'MATERIALS',
  FREIGHT_INVOICE: 'LOGISTICS', DELIVERY_NOTE: 'LOGISTICS',
  BILL_OF_LADING: 'LOGISTICS',
  CUSTOMS_DECLARATION: 'COMPLIANCE', CBAM_DECLARATION: 'COMPLIANCE',
  ENVIRONMENTAL_CERTIFICATE: 'COMPLIANCE', PRODUCT_CERTIFICATE: 'COMPLIANCE',
  CHAIN_OF_CUSTODY: 'COMPLIANCE', SUPPLIER_QUESTIONNAIRE: 'COMPLIANCE',
  SUPPLIER_INVOICE: 'MATERIALS', PURCHASE_ORDER: 'MATERIALS',
  WASTE_RECORD: 'WASTE_AND_WATER', WATER_RECORD: 'WASTE_AND_WATER',
  CARBON_FOOTPRINT_REPORT: 'EMISSIONS', EMISSIONS_FACTOR_DOC: 'EMISSIONS',
  CROP_YIELD_RECORD: 'AGRICULTURE', FERTILISER_RECORD: 'AGRICULTURE',
  LIVESTOCK_RECORD: 'AGRICULTURE', LAND_USE_CERTIFICATE: 'AGRICULTURE',
}

export function docTypeToDomain(docType: string): string | null {
  return DOC_TYPE_TO_DOMAIN[docType] ?? null
}

export function getCompulsoryFieldsByDomain(): Record<string, string[]> {
  const byDomain: Record<string, string[]> = {}
  for (const [docType, defs] of Object.entries(DOCUMENT_FIELD_DEFINITIONS)) {
    const domain = docTypeToDomain(docType)
    if (!domain) continue
    if (!byDomain[domain]) byDomain[domain] = []
    for (const d of defs) {
      if (d.admissibility === 'compulsory' && !byDomain[domain].includes(d.name)) {
        byDomain[domain].push(d.name)
      }
    }
  }
  return byDomain
}
