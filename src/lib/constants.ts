import { z } from 'zod'

/**
 * Domain vocabulary enums.
 *
 * These mirror the enums declared in prisma/schema.prisma exactly (same string
 * members). They are defined here independently of @prisma/client so this module
 * carries no database dependency and is safe to import from client components.
 * Because they are string-literal unions with identical members, values produced
 * here are structurally assignable to the Prisma-generated enum types at the
 * Layer 2 write boundary, and vice versa.
 *
 * If a member is added or renamed in the Prisma schema, update it here too.
 */

export const DataDomain = {
  ENERGY: 'ENERGY',
  MATERIALS: 'MATERIALS',
  PRODUCTION: 'PRODUCTION',
  LOGISTICS: 'LOGISTICS',
  EMISSIONS: 'EMISSIONS',
  AGRICULTURE: 'AGRICULTURE',
  WASTE_AND_WATER: 'WASTE_AND_WATER',
  COMPLIANCE: 'COMPLIANCE',
} as const
export type DataDomain = (typeof DataDomain)[keyof typeof DataDomain]

export const TrustTier = {
  A: 'A',
  B: 'B',
  C: 'C',
} as const
export type TrustTier = (typeof TrustTier)[keyof typeof TrustTier]

export const ExtractionMethod = {
  DOCUMENT_AI: 'DOCUMENT_AI',
  MANUAL_ENTRY: 'MANUAL_ENTRY',
  SYSTEM_INTEGRATION: 'SYSTEM_INTEGRATION',
} as const
export type ExtractionMethod = (typeof ExtractionMethod)[keyof typeof ExtractionMethod]

export const DocumentType = {
  ELECTRICITY_BILL: 'ELECTRICITY_BILL',
  GAS_BILL: 'GAS_BILL',
  FUEL_RECEIPT: 'FUEL_RECEIPT',
  RENEWABLE_CERTIFICATE: 'RENEWABLE_CERTIFICATE',
  PRODUCTION_LOG: 'PRODUCTION_LOG',
  MATERIAL_INTAKE: 'MATERIAL_INTAKE',
  BILL_OF_MATERIALS: 'BILL_OF_MATERIALS',
  PROCESS_DATA_SHEET: 'PROCESS_DATA_SHEET',
  FREIGHT_INVOICE: 'FREIGHT_INVOICE',
  DELIVERY_NOTE: 'DELIVERY_NOTE',
  CUSTOMS_DECLARATION: 'CUSTOMS_DECLARATION',
  BILL_OF_LADING: 'BILL_OF_LADING',
  SUPPLIER_INVOICE: 'SUPPLIER_INVOICE',
  PURCHASE_ORDER: 'PURCHASE_ORDER',
  SUPPLIER_QUESTIONNAIRE: 'SUPPLIER_QUESTIONNAIRE',
  EMISSIONS_FACTOR_DOC: 'EMISSIONS_FACTOR_DOC',
  ENVIRONMENTAL_CERTIFICATE: 'ENVIRONMENTAL_CERTIFICATE',
  CARBON_FOOTPRINT_REPORT: 'CARBON_FOOTPRINT_REPORT',
  WATER_RECORD: 'WATER_RECORD',
  WASTE_RECORD: 'WASTE_RECORD',
  CROP_YIELD_RECORD: 'CROP_YIELD_RECORD',
  FERTILISER_RECORD: 'FERTILISER_RECORD',
  LIVESTOCK_RECORD: 'LIVESTOCK_RECORD',
  LAND_USE_CERTIFICATE: 'LAND_USE_CERTIFICATE',
  CBAM_DECLARATION: 'CBAM_DECLARATION',
  ESG_REPORT: 'ESG_REPORT',
  AUDIT_REPORT: 'AUDIT_REPORT',
  PRODUCT_CERTIFICATE: 'PRODUCT_CERTIFICATE',
  CHAIN_OF_CUSTODY: 'CHAIN_OF_CUSTODY',
  OTHER: 'OTHER',
} as const
export type DocumentType = (typeof DocumentType)[keyof typeof DocumentType]

export const domainSchema = z.nativeEnum(DataDomain)
export const tierSchema = z.nativeEnum(TrustTier)
export const extractionMethodSchema = z.nativeEnum(ExtractionMethod)
export const documentTypeSchema = z.nativeEnum(DocumentType)

export const ALL_DOMAINS = Object.values(DataDomain)
export const ALL_TIERS = Object.values(TrustTier)

export const DOCUMENT_MAX_BYTES = 50 * 1024 * 1024 // 50 MB

// Caps on a single inbound email so a hostile sender cannot fan one message out
// into unbounded storage/extraction work.
export const MAX_INBOUND_ATTACHMENTS = 10

// Upper bound on records written in a single request/transaction. Caps how long a
// serializable transaction can hold locks and how much memory one payload consumes.
export const MAX_BATCH_ENTRIES = 200

// batch/mill records go stale this many days after the period they cover.
export const BATCH_RECORD_STALE_DAYS = 90

export const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
])

/** Canonical mapping from DocumentType to DataDomain.
 *  Single source of truth — used by ExtractionReview, review page, and cross-validation.
 */
export const DOMAIN_BY_DOCUMENT_TYPE: Record<string, DataDomain> = {
  ELECTRICITY_BILL: DataDomain.ENERGY,
  GAS_BILL: DataDomain.ENERGY,
  FUEL_RECEIPT: DataDomain.ENERGY,
  RENEWABLE_CERTIFICATE: DataDomain.ENERGY,
  PRODUCTION_LOG: DataDomain.PRODUCTION,
  PROCESS_DATA_SHEET: DataDomain.PRODUCTION,
  MATERIAL_INTAKE: DataDomain.MATERIALS,
  BILL_OF_MATERIALS: DataDomain.MATERIALS,
  SUPPLIER_INVOICE: DataDomain.MATERIALS,
  PURCHASE_ORDER: DataDomain.MATERIALS,
  FREIGHT_INVOICE: DataDomain.LOGISTICS,
  DELIVERY_NOTE: DataDomain.LOGISTICS,
  CUSTOMS_DECLARATION: DataDomain.LOGISTICS,
  BILL_OF_LADING: DataDomain.LOGISTICS,
  CBAM_DECLARATION: DataDomain.COMPLIANCE,
  PRODUCT_CERTIFICATE: DataDomain.COMPLIANCE,
  ENVIRONMENTAL_CERTIFICATE: DataDomain.COMPLIANCE,
  CHAIN_OF_CUSTODY: DataDomain.COMPLIANCE,
  ESG_REPORT: DataDomain.COMPLIANCE,
  AUDIT_REPORT: DataDomain.COMPLIANCE,
  OTHER: DataDomain.COMPLIANCE,
  CARBON_FOOTPRINT_REPORT: DataDomain.EMISSIONS,
  EMISSIONS_FACTOR_DOC: DataDomain.EMISSIONS,
  WASTE_RECORD: DataDomain.WASTE_AND_WATER,
  WATER_RECORD: DataDomain.WASTE_AND_WATER,
  CROP_YIELD_RECORD: DataDomain.AGRICULTURE,
  FERTILISER_RECORD: DataDomain.AGRICULTURE,
  LIVESTOCK_RECORD: DataDomain.AGRICULTURE,
  LAND_USE_CERTIFICATE: DataDomain.AGRICULTURE,
}
