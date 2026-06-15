import { z } from 'zod'
import { DataDomain, TrustTier, ExtractionMethod, DocumentType } from '@prisma/client'

export { DataDomain, TrustTier, ExtractionMethod, DocumentType }

export const domainSchema = z.nativeEnum(DataDomain)
export const tierSchema = z.nativeEnum(TrustTier)
export const extractionMethodSchema = z.nativeEnum(ExtractionMethod)
export const documentTypeSchema = z.nativeEnum(DocumentType)

export const ALL_DOMAINS = Object.values(DataDomain)
export const ALL_TIERS = Object.values(TrustTier)

export const DOCUMENT_MAX_BYTES = 50 * 1024 * 1024 // 50 MB

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
